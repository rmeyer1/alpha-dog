function groupedInteger(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function finiteNumber(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : null;
}

const BIGINT_ONE = BigInt(1);
const BIGINT_TWO = BigInt(2);
const BIGINT_TEN = BigInt(10);

function roundDecimal(value: number, fractionDigits: number) {
  const [coefficient, exponentText = "0"] = value.toString().split("e");
  const [integer, fraction = ""] = coefficient.split(".");
  const digits = BigInt(`${integer}${fraction}`);
  const shift = fractionDigits - fraction.length + Number(exponentText);

  if (shift >= 0) {
    return digits * BIGINT_TEN ** BigInt(shift);
  }

  const divisor = BIGINT_TEN ** BigInt(-shift);
  const quotient = digits / divisor;
  const remainder = digits % divisor;

  return remainder * BIGINT_TWO >= divisor ? quotient + BIGINT_ONE : quotient;
}

function decimalParts(value: bigint, fractionDigits: number) {
  const digits = value.toString().padStart(fractionDigits + 1, "0");

  return {
    integer: digits.slice(0, -fractionDigits),
    fraction: digits.slice(-fractionDigits),
  };
}

function fixedCompact(value: bigint) {
  const { integer, fraction } = decimalParts(value, 1);

  return fraction === "0" ? integer : `${integer}.${fraction}`;
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

  const { integer, fraction } = decimalParts(
    roundDecimal(Math.abs(number), 2),
    2,
  );

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
  const units = [
    { divisor: 1, suffix: "M" },
    { divisor: 1_000, suffix: "B" },
    { divisor: 1_000_000, suffix: "T" },
  ];
  let unitIndex =
    absoluteMillions >= units[2].divisor
      ? 2
      : absoluteMillions >= units[1].divisor
        ? 1
        : 0;
  let compact = roundDecimal(
    absoluteMillions / units[unitIndex].divisor,
    1,
  );

  if (compact >= BigInt(10_000) && unitIndex < units.length - 1) {
    unitIndex += 1;
    compact = roundDecimal(
      absoluteMillions / units[unitIndex].divisor,
      1,
    );
  }

  return `${millions < 0 ? "-" : ""}$${fixedCompact(compact)}${units[unitIndex].suffix}`;
}
