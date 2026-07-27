function groupedInteger(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function finiteNumber(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : null;
}

function fixedCompact(value: number) {
  return value.toFixed(1).replace(/\.0$/, "");
}

/**
 * Company insights render on the server and hydrate in the browser. These
 * formatters intentionally avoid Intl so their output cannot vary with the
 * runtime's ICU/locale implementation.
 */
export function formatCompanyCurrency(value: number | null | undefined) {
  const number = finiteNumber(value);

  if (number == null) {
    return "-";
  }

  const [integer, fraction] = Math.abs(number).toFixed(2).split(".");

  return `${number < 0 ? "-" : ""}$${groupedInteger(integer)}.${fraction}`;
}

export function formatCompanyInteger(value: number | null | undefined) {
  const number = finiteNumber(value);

  if (number == null) {
    return "-";
  }

  return `${number < 0 ? "-" : ""}${groupedInteger(
    String(Math.round(Math.abs(number))),
  )}`;
}

export function formatCompanyMarketCapFromMillions(
  value: number | null | undefined,
) {
  const millions = finiteNumber(value);

  if (millions == null) {
    return "-";
  }

  const absoluteMillions = Math.abs(millions);
  let scaled = absoluteMillions;
  let suffix = "M";

  if (absoluteMillions >= 1_000_000) {
    scaled = absoluteMillions / 1_000_000;
    suffix = "T";
  } else if (absoluteMillions >= 1_000) {
    scaled = absoluteMillions / 1_000;
    suffix = "B";
  }

  return `${millions < 0 ? "-" : ""}$${fixedCompact(scaled)}${suffix}`;
}
