import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse, type NextRequest } from "next/server";
import {
  ACCOUNT_EXPORT_FAILED,
  createAccountExportDocument,
} from "@/lib/account/data-lifecycle";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";

async function GETHandler(request: NextRequest) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(
      auth.code,
      "account export",
      authResponse,
    );
  }

  const exported = await auth.supabase.rpc("export_account_data");

  if (exported.error || !exported.data) {
    return copyAuthCookies(
      auth.response,
      NextResponse.json(
        {
          error: {
            code: ACCOUNT_EXPORT_FAILED,
            message: "Unable to prepare your account export.",
          },
        },
        { status: 502 },
      ),
    );
  }

  const document = createAccountExportDocument(
    auth.user.id,
    exported.data,
  );
  const date = document.exportedAt.slice(0, 10);
  const response = new NextResponse(
    `${JSON.stringify(document, null, 2)}\n`,
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition":
          `attachment; filename="alpha-dog-account-export-${date}.json"`,
        "Content-Type": "application/json; charset=utf-8",
        Expires: "0",
        Pragma: "no-cache",
      },
      status: 200,
    },
  );

  return copyAuthCookies(auth.response, response);
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/account/export" },
  GETHandler,
);
