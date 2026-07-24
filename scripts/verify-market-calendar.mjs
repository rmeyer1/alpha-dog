import { readFile } from "node:fs/promises";

const calendar = JSON.parse(
  await readFile(
    new URL(
      "../src/lib/market/us-equities-calendar.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const errors = [];
const entries = [
  ...calendar.holidays,
  ...calendar.exceptionalClosures,
  ...calendar.earlyCloses,
];
const entryDates = entries.map((entry) => entry.date);

function validCalendarDate(value) {
  if (!datePattern.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

if (calendar.schemaVersion !== 1) {
  errors.push(`schemaVersion must be 1; found ${calendar.schemaVersion}.`);
}

if (calendar.timeZone !== "America/New_York") {
  errors.push(`Unexpected calendar time zone: ${calendar.timeZone}.`);
}

if (!calendar.owner?.trim()) {
  errors.push("A calendar owner is required.");
}

if (!validCalendarDate(calendar.verifiedAt)) {
  errors.push(`verifiedAt is invalid: ${calendar.verifiedAt}.`);
}

if (
  !validCalendarDate(calendar.coverage.start) ||
  !validCalendarDate(calendar.coverage.end) ||
  calendar.coverage.start > calendar.coverage.end
) {
  errors.push("Calendar coverage must contain a valid ordered date range.");
}

if (
  !calendar.sources.some((source) =>
    source.startsWith("https://www.nyse.com/")
  ) ||
  !calendar.sources.some((source) =>
    source.startsWith("https://docs.alpaca.markets/")
  )
) {
  errors.push("NYSE and Alpaca source references are both required.");
}

for (const entry of entries) {
  if (!validCalendarDate(entry.date)) {
    errors.push(`Invalid calendar entry date: ${entry.date}.`);
  }

  if (
    entry.date < calendar.coverage.start ||
    entry.date > calendar.coverage.end
  ) {
    errors.push(`Calendar entry ${entry.date} is outside coverage.`);
  }

  if (!entry.name?.trim()) {
    errors.push(`Calendar entry ${entry.date} requires a name.`);
  }
}

if (new Set(entryDates).size !== entryDates.length) {
  errors.push("Calendar closure and early-close dates must be unique.");
}

for (const entry of calendar.earlyCloses) {
  if (entry.close !== "13:00") {
    errors.push(`Early close ${entry.date} must use 13:00 Eastern.`);
  }
}

const minimumHorizon = new Date();
minimumHorizon.setUTCDate(minimumHorizon.getUTCDate() + 365);
const coverageEnd = new Date(`${calendar.coverage.end}T23:59:59.999Z`);

if (coverageEnd < minimumHorizon) {
  errors.push(
    `Calendar coverage ends ${calendar.coverage.end}; maintain at least ` +
    "365 future days before shipping.",
  );
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  `Market calendar verified: ${calendar.coverage.start} through ` +
  `${calendar.coverage.end}; ${entries.length} exceptions; owner ` +
  `${calendar.owner}.`,
);
