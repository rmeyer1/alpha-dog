import { WheelDashboard } from "@/components/wheel-dashboard";
import { getUsEquitiesMarketState } from "@/lib/market/us-equities-calendar";
import { personas } from "@/lib/wheel/personas";
import { connection } from "next/server";

export default async function ScreenersPage() {
  await connection();

  return (
    <WheelDashboard
      initialMarketState={getUsEquitiesMarketState()}
      initialPersonas={personas}
    />
  );
}
