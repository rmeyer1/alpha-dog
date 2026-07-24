import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse } from "next/server";
import { personas } from "@/lib/wheel/personas";

async function GETHandler() {
  return NextResponse.json({ personas });
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/wheel/personas" },
  GETHandler,
);
