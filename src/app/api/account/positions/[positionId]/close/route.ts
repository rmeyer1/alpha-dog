import { NextResponse, type NextRequest } from "next/server";
import {
  closeSimulatedPosition,
  closeSimulatedPositionInputSchema,
  SimulatedPositionValidationError,
} from "@/lib/account/simulated-positions";
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

export async function POST(request: NextRequest, context: RouteContext) {
  const { positionId } = await context.params;
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(auth.code, "simulated positions");
  }

  const json = await request.json().catch(() => null);
  const parsed = closeSimulatedPositionInputSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_SIMULATED_POSITION_CLOSE",
          message: "Simulated position close payload is invalid.",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await closeSimulatedPosition(
      auth.supabase,
      auth.user.id,
      positionId,
      parsed.data,
    );

    return copyAuthCookies(auth.response, NextResponse.json(result));
  } catch (error) {
    if (error instanceof SimulatedPositionValidationError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status },
      );
    }

    throw error;
  }
}
