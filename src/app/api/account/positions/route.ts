import { NextResponse, type NextRequest } from "next/server";
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

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(auth.code, "simulated positions");
  }

  const json = await request.json().catch(() => null);
  const parsed = simulatedPositionInputSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_SIMULATED_POSITION",
          message: "Simulated position payload is invalid.",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
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
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: 400 },
      );
    }

    throw error;
  }
}
