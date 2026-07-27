import type { PositionLifecycleSummary } from "./contracts";
import { lifecycleLabel } from "./formatting";

function statusTone(
  status: string,
  lifecycle?: PositionLifecycleSummary | null,
) {
  if (lifecycle?.outcome === "expired_otm")
    return "border-sky-300/25 bg-sky-300/10 text-sky-100";
  if (lifecycle?.outcome === "manual_review" || status === "manual_review")
    return "border-red-300/25 bg-red-300/10 text-red-100";
  if (
    lifecycle?.outcome === "assigned" ||
    lifecycle?.outcome === "called_away" ||
    ["assigned", "called_away"].includes(status)
  )
    return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  if (["open", "partially_closed"].includes(status))
    return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  return "border-white/10 bg-white/[0.04] text-zinc-200";
}

export function PositionStatusPill({
  lifecycle,
  status,
}: {
  lifecycle?: PositionLifecycleSummary | null;
  status: string;
}) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-md border px-2 py-1 text-xs font-semibold ${statusTone(status, lifecycle)}`}
    >
      {lifecycleLabel(status, lifecycle)}
    </span>
  );
}
