import { NextResponse, type NextRequest } from "next/server";
import { loadAccountPositionDetail } from "@/lib/account/simulated-account-portfolio";
import {
  AccountPaginationError,
  DEFAULT_EVENT_PAGE_SIZE,
  MAX_EVENT_PAGE_SIZE,
  parseEventCursor,
  parsePageSize,
} from "@/lib/account/pagination";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";

interface RouteContext {
  params: Promise<{
    positionId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { positionId } = await context.params;
  const searchParams = new URL(request.url).searchParams;
  let eventLimit: number;

  try {
    eventLimit = parsePageSize(
      searchParams.get("eventPageSize"),
      {
        defaultSize: DEFAULT_EVENT_PAGE_SIZE,
        maxSize: MAX_EVENT_PAGE_SIZE,
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

  let position;

  try {
    const eventCursor = parseEventCursor(
      searchParams.get("eventCursor"),
      positionId,
      auth.user.id,
    );
    position = await loadAccountPositionDetail(
      auth.supabase,
      auth.user.id,
      positionId,
      { eventCursor, eventLimit },
    );
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

  if (!position) {
    return copyAuthCookies(
      auth.response,
      NextResponse.json(
        {
          error: {
            code: "SIMULATED_POSITION_NOT_FOUND",
            message: "Simulated position was not found.",
          },
        },
        { status: 404 },
      ),
    );
  }

  return copyAuthCookies(auth.response, NextResponse.json({ position }));
}
