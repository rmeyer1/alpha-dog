import { getConfigurationSummary } from "@/lib/observability/health";
import { instrumentApiRoute } from "@/lib/observability/route";

export const dynamic = "force-dynamic";

async function GETHandler() {
  const health = getConfigurationSummary();

  return Response.json(
    health,
    {
      headers: {
        "Cache-Control": "no-store",
      },
      status: health.status === "invalid" ? 503 : 200,
    },
  );
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/health/configuration" },
  GETHandler,
);
