import type {
  PositionDataProvenance,
  PositionLifecycleSummary,
} from "./contracts";

export function formatCurrency(value: number | null | undefined) {
  if (value == null) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}
export function formatDate(value: string | null | undefined) {
  if (!value) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
export function formatCompactDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  }).format(new Date(value));
}
export function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}
export function formatNumber(value: number | null | undefined) {
  return value == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
        value,
      );
}
export function todayInputDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function closeDateTimestamp(value: string) {
  return `${value}T12:00:00.000Z`;
}
export function labelize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export function strategyLabel(value: string) {
  return labelize(value);
}
export function positionKind(value: string) {
  return value === "simulated" ? "Paper" : labelize(value);
}
export function provenanceLabel(provenance: PositionDataProvenance) {
  if (provenance.sourceMode === "unknown") return "Provenance unavailable";
  return [
    provenance.sourceMode === "demo" ? "Demo" : "Live",
    provenance.feed ? labelize(provenance.feed) : null,
    provenance.cacheStatus ? `${labelize(provenance.cacheStatus)} cache` : null,
    provenance.cacheSource ? labelize(provenance.cacheSource) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
export function lifecycleLabel(
  status: string,
  lifecycle?: PositionLifecycleSummary | null,
) {
  switch (lifecycle?.outcome) {
    case "assigned":
      return "Assigned";
    case "called_away":
      return "Called away";
    case "expired_otm":
      return "Expired OTM";
    case "manual_review":
      return "Manual review";
    default:
      return status === "closed" ? "Closed" : labelize(status);
  }
}
