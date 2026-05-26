export function formatCurrency(value: number | null | undefined) {
  if (value == null) return "-";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number | null | undefined) {
  if (value == null) return "-";

  return `${(value * 100).toFixed(1)}%`;
}

export function formatCompactNumber(value: number | null | undefined) {
  if (value == null) return "-";

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatScoreLabel(value: number | null | undefined) {
  if (value == null) return "-";

  return value.toFixed(1).replace(/\.0$/, "");
}

export function contractValue(value: number | null | undefined) {
  if (value == null) return "-";

  return formatCurrency(value * 100);
}
