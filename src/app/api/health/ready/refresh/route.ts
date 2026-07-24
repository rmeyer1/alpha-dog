import { getEnv } from "@/lib/env";
import { refreshSharedReadinessSummary } from "@/lib/observability/health";
import { instrumentApiRoute } from "@/lib/observability/route";

export const dynamic = "force-dynamic";

function unauthorized() {
  return Response.json(
    {
      error: {
        code: "UNAUTHORIZED_READINESS_REFRESH",
        message: "Readiness refresh authorization failed.",
      },
    },
    { status: 401 },
  );
}

async function GETHandler(request: Request) {
  const expectedSecret = getEnv().CRON_SECRET;

  if (
    !expectedSecret ||
    request.headers.get("authorization") !== `Bearer ${expectedSecret}`
  ) {
    return unauthorized();
  }

  const summary = await refreshSharedReadinessSummary();

  return Response.json(summary, {
    headers: { "Cache-Control": "private, no-store" },
    status: summary.status === "ready" ? 200 : 503,
  });
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/health/ready/refresh" },
  GETHandler,
);
