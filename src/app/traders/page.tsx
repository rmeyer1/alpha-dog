import type { Metadata } from "next";
import { TraderIntelligence } from "@/components/trader-intelligence";

export const metadata: Metadata = {
  title: "Trader Intelligence | Alpha Dog",
  description: "Polymarket trader and whale-edge intelligence for Alpha Dog.",
};

export default function TradersPage() {
  return <TraderIntelligence />;
}
