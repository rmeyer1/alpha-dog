import { WheelDashboard } from "@/components/wheel-dashboard";
import { personas } from "@/lib/wheel/personas";

export default function Home() {
  return <WheelDashboard initialPersonas={personas} />;
}
