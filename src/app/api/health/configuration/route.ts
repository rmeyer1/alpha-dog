import { NextResponse } from "next/server";
import { getDeploymentHealth } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = getDeploymentHealth();

  return NextResponse.json(
    health,
    {
      headers: {
        "Cache-Control": "no-store",
      },
      status: health.status === "invalid" ? 503 : 200,
    },
  );
}
