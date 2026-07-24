import { getReadinessSummary } from "@/lib/observability/health";
import { instrumentApiRoute } from "@/lib/observability/route";

export const dynamic = "force-dynamic";

async function GETHandler() {
  const summary = await getReadinessSummary();

  return Response.json(summary, {
    headers: {
      "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10",
    },
    status: summary.status === "ready" ? 200 : 503,
  });
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/health/ready" },
  GETHandler,
);
