export const COMPANY_DISPLAY_TIME_ZONE = "UTC";

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const offsetInstantPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/i;

interface UtcDateParts {
  day: number;
  hour: number;
  minute: number;
  monthIndex: number;
  year: number;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function hasValidCalendarDate(year: number, month: number, day: number) {
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

function partsFromTimestamp(timestamp: number): UtcDateParts | null {
  const date = new Date(timestamp);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return {
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    monthIndex: date.getUTCMonth(),
    year: date.getUTCFullYear(),
  };
}

function parseDateOnly(value: string): UtcDateParts | null {
  const match = dateOnlyPattern.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return hasValidCalendarDate(year, month, day)
    ? { day, hour: 0, minute: 0, monthIndex: month - 1, year }
    : null;
}

function parseOffsetInstant(value: string): UtcDateParts | null {
  const match = offsetInstantPattern.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? "").slice(0, 3).padEnd(3, "0"));
  const offsetHour = Number(match[10] ?? 0);
  const offsetMinute = Number(match[11] ?? 0);

  if (
    !hasValidCalendarDate(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }

  const localDate = new Date(0);

  localDate.setUTCFullYear(year, month - 1, day);
  localDate.setUTCHours(hour, minute, second, millisecond);

  const offsetSign = match[9] === "-" ? -1 : 1;
  const offsetMilliseconds =
    offsetSign * (offsetHour * 60 + offsetMinute) * 60_000;

  return partsFromTimestamp(localDate.getTime() - offsetMilliseconds);
}

function formatDateParts(parts: UtcDateParts) {
  return `${monthNames[parts.monthIndex]} ${parts.day}, ${parts.year}`;
}

function formatTimeParts(parts: UtcDateParts) {
  const period = parts.hour < 12 ? "AM" : "PM";
  const hour = parts.hour % 12 || 12;

  return `${hour}:${String(parts.minute).padStart(2, "0")} ${period} UTC`;
}

/**
 * Company-route dates are prerendered on the server and may render again in
 * the browser during hydration. Fixed English month names, UTC getters, and
 * literal punctuation keep the initial markup independent of Intl/ICU data.
 *
 * Date-only input must be exactly YYYY-MM-DD. Date-time input must carry Z or
 * a numeric offset; invalid and zone-less values fail closed to "-".
 */
export function formatCompanyDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const parts = parseDateOnly(value) ?? parseOffsetInstant(value);

  return parts ? formatDateParts(parts) : "-";
}

export function formatCompanyDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const parts = parseOffsetInstant(value);

  return parts ? `${formatDateParts(parts)}, ${formatTimeParts(parts)}` : "-";
}

export function formatCompanyNewsDate(value: number | null | undefined) {
  if (value == null || !Number.isSafeInteger(value)) {
    return "-";
  }

  const parts = partsFromTimestamp(value * 1000);

  return parts
    ? `${monthNames[parts.monthIndex]} ${parts.day}, ${formatTimeParts(parts)}`
    : "-";
}
