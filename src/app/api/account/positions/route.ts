import { NextResponse, type NextRequest } from "next/server";
import {
  loadAccountPositionPage,
  loadPaperAccountOverview,
} from "@/lib/account/simulated-account-portfolio";
import {
  AccountPaginationError,
  DEFAULT_POSITION_PAGE_SIZE,
  MAX_POSITION_PAGE_SIZE,
  parsePageSize,
  parsePositionCursor,
  parsePositionScope,
} from "@/lib/account/pagination";
import {
  createSimulatedPosition,
  SimulatedPositionValidationError,
  simulatedPositionInputSchema,
} from "@/lib/account/simulated-positions";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";

export async function GET(request: NextRequest) {
  const searchParams = new URL(request.url).searchParams;
  let historyLimit: number;
  let openLimit: number;
  let scope: ReturnType<typeof parsePositionScope>;

  try {
    scope = parsePositionScope(searchParams.get("scope"));
    historyLimit = parsePageSize(
      searchParams.get("historyPageSize"),
      {
        defaultSize: DEFAULT_POSITION_PAGE_SIZE,
        maxSize: MAX_POSITION_PAGE_SIZE,
      },
    );
    openLimit = parsePageSize(
      searchParams.get("openPageSize"),
      {
        defaultSize: DEFAULT_POSITION_PAGE_SIZE,
        maxSize: MAX_POSITION_PAGE_SIZE,
      },
    );
  } catch (error) {
    if (error instanceof AccountPaginationError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }

    throw error;
  }

  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(
      auth.code,
      "simulated positions",
      authResponse,
    );
  }

  try {
    const historyCursor = scope === "open"
      ? null
      : parsePositionCursor(
        searchParams.get("historyCursor"),
        "history",
        auth.user.id,
      );
    const openCursor = scope === "history"
      ? null
      : parsePositionCursor(
        searchParams.get("openCursor"),
        "open",
        auth.user.id,
      );
    const overview = await loadPaperAccountOverview(
      auth.supabase,
      auth.user.id,
    );
    const [historyPage, openPage] = await Promise.all([
      scope === "open"
        ? null
        : loadAccountPositionPage(auth.supabase, auth.user.id, {
          cursor: historyCursor,
          limit: historyLimit,
          scope: "history",
          watermark: overview.positionWatermark,
        }),
      scope === "history"
        ? null
        : loadAccountPositionPage(auth.supabase, auth.user.id, {
          cursor: openCursor,
          limit: openLimit,
          scope: "open",
          watermark: overview.positionWatermark,
        }),
    ]);
    const pages = {
      ...(historyPage
        ? {
          history: {
            items: historyPage.positions,
            nextCursor: historyPage.nextCursor,
            total: overview.historyPositionCount,
          },
        }
        : {}),
      ...(openPage
        ? {
          open: {
            items: openPage.positions,
            nextCursor: openPage.nextCursor,
            total: overview.openPositionCount,
          },
        }
        : {}),
    };

    return copyAuthCookies(auth.response, NextResponse.json({
      historyPositions: historyPage?.positions,
      openPositions: openPage?.positions,
      pages,
      summary: overview.summary,
    }));
  } catch (error) {
    if (error instanceof AccountPaginationError) {
      return copyAuthCookies(
        auth.response,
        NextResponse.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        ),
      );
    }

    throw error;
  }
}

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(
      auth.code,
      "simulated positions",
      authResponse,
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = simulatedPositionInputSchema.safeParse(json);

  if (!parsed.success) {
    return copyAuthCookies(
      auth.response,
      NextResponse.json(
        {
          error: {
            code: "INVALID_SIMULATED_POSITION",
            message: "Simulated position payload is invalid.",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 },
      ),
    );
  }

  try {
    const result = await createSimulatedPosition(
      auth.supabase,
      auth.user.id,
      parsed.data,
    );

    return copyAuthCookies(
      auth.response,
      NextResponse.json(result, { status: 201 }),
    );
  } catch (error) {
    if (error instanceof SimulatedPositionValidationError) {
      return copyAuthCookies(
        auth.response,
        NextResponse.json(
          {
            error: {
              code: error.code,
              message: error.message,
            },
          },
          { status: 400 },
        ),
      );
    }

    throw error;
  }
}
