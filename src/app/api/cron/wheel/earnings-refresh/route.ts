import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getSupabaseServiceConfig } from "@/lib/supabase/rest";
import {
  earningsRefreshWindow,
  refreshFinnhubEarningsCache,
} from "@/lib/wheel/earnings";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json(
    {
      error: {
        code: "UNAUTHORIZED_CRON_REQUEST",
        message: "Cron authorization failed.",
      },
    },
    { status: 401 },
  );
}

function verifyCronRequest(request: Request) {
  const expectedSecret = getEnv().CRON_SECRET;

  if (!expectedSecret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          error: {
            code: "CRON_SECRET_NOT_CONFIGURED",
            message:
              "CRON_SECRET must be configured for scheduled earnings refreshes.",
          },
        },
        { status: 503 },
      );
    }

    return null;
  }

  return request.headers.get("authorization") === `Bearer ${expectedSecret}`
    ? null
    : unauthorized();
}

async function handleEarningsRefresh(request: Request) {
  const authError = verifyCronRequest(request);

  if (authError) {
    return authError;
  }

  const env = getEnv();

  if (!getSupabaseServiceConfig()) {
    return NextResponse.json(
      {
        error: {
          code: "SUPABASE_SERVICE_ROLE_NOT_CONFIGURED",
          message:
            "Supabase service-role configuration is required for earnings refresh.",
        },
      },
      { status: 503 },
    );
  }

  if (!env.EARNINGS_PROVIDER_ENABLED || !env.FINNHUB_API_KEY) {
    return NextResponse.json(
      {
        error: {
          code: "FINNHUB_EARNINGS_PROVIDER_NOT_CONFIGURED",
          message:
            "EARNINGS_PROVIDER_ENABLED=true and FINNHUB_API_KEY are required for earnings refresh.",
        },
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const window = earningsRefreshWindow();
  const from = url.searchParams.get("from") ?? window.from;
  const to = url.searchParams.get("to") ?? window.to;

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun,
      from,
      message: "Finnhub earnings refresh dry run.",
      to,
    });
  }

  const summary = await refreshFinnhubEarningsCache({ from, to });

  return NextResponse.json({
    ok: true,
    dryRun,
    ...summary,
  });
}

export async function GET(request: Request) {
  return handleEarningsRefresh(request);
}

export async function POST(request: Request) {
  return handleEarningsRefresh(request);
}
