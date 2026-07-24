import { instrumentApiRoute } from "@/lib/observability/route";
import { NextRequest, NextResponse } from "next/server";
import { LOGOUT_FAILED, signOutSupabaseSession } from "@/lib/supabase/logout";
import { createSupabaseRouteClient } from "@/lib/supabase/server";

async function POSTHandler(request: NextRequest) {
  const response = NextResponse.json({ status: "signed_out" });
  const supabase = createSupabaseRouteClient(request, response);
  const result = await signOutSupabaseSession(supabase);

  if (result.status === "error") {
    return NextResponse.json(
      {
        error: {
          code: LOGOUT_FAILED,
          message: "Unable to sign out. Please try again.",
        },
      },
      { status: 502 },
    );
  }

  return response;
}

export const POST = instrumentApiRoute(
  { method: "POST", route: "/api/auth/logout" },
  POSTHandler,
);
