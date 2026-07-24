import { instrumentApiRoute } from "@/lib/observability/route";

export const dynamic = "force-dynamic";

async function GETHandler() {
  return Response.json(
    { status: "alive" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/health/live" },
  GETHandler,
);
