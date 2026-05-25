import { NextResponse } from "next/server";
import { personas } from "@/lib/wheel/personas";

export async function GET() {
  return NextResponse.json({ personas });
}
