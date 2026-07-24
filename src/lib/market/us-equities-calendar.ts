import calendarJson from "./us-equities-calendar.json";

const REGULAR_OPEN_MINUTES = 9 * 60 + 30;
const REGULAR_CLOSE_MINUTES = 16 * 60;
const PREWARM_OPEN_MINUTES = 16 * 60;
const PREWARM_CLOSE_MINUTES = 18 * 60;
const PREWARM_MAX_LEAD_MS = 18 * 60 * 60 * 1000;

interface CalendarEntry {
  date: string;
  name: string;
}

interface EarlyCloseEntry extends CalendarEntry {
  close: string;
}

interface UsEquitiesCalendarData {
  coverage: {
    end: string;
    start: string;
  };
  earlyCloses: EarlyCloseEntry[];
  exceptionalClosures: CalendarEntry[];
  holidays: CalendarEntry[];
  owner: string;
  schemaVersion: number;
  sources: string[];
  timeZone: "America/New_York";
  verifiedAt: string;
}

export interface UsEquitiesSession {
  closeAt: string;
  closeMinutes: number;
  date: string;
  name: string | null;
  openAt: string;
  openMinutes: number;
  sessionType: "early_close" | "regular";
}

export interface UsEquitiesMarketState {
  calendarCovered: boolean;
  calendarDate: string;
  closeAt: string | null;
  closeMinutes: number | null;
  easternMinutes: number;
  holidayName: string | null;
  isMarketDay: boolean;
  isOpen: boolean;
  isWeekendPrewarm: boolean;
  nextSession: UsEquitiesSession | null;
  openAt: string | null;
  openMinutes: number | null;
  phase:
    | "after_hours"
    | "calendar_unavailable"
    | "closed"
    | "open"
    | "pre_market";
  sessionType: "closed" | "early_close" | "regular";
  weekday: string;
}

interface NewYorkDateTimeParts {
  calendarDate: string;
  easternMinutes: number;
  weekday: string;
}

const calendar = calendarJson as UsEquitiesCalendarData;
const closures = new Map(
  [...calendar.holidays, ...calendar.exceptionalClosures].map((entry) => [
    entry.date,
    entry.name,
  ]),
);
const earlyCloses = new Map(
  calendar.earlyCloses.map((entry) => [entry.date, entry]),
);
const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const newYorkFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: calendar.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const usEquitiesCalendarMetadata = {
  coverage: calendar.coverage,
  owner: calendar.owner,
  sources: calendar.sources,
  timeZone: calendar.timeZone,
  verifiedAt: calendar.verifiedAt,
} as const;

function parseCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }

  return { day, month, year };
}

function calendarDateFromUtcDate(date: Date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function addCalendarDays(calendarDate: string, days: number) {
  const { day, month, year } = parseCalendarDate(calendarDate);
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return calendarDateFromUtcDate(date);
}

function parseClockMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);

  if (!match) {
    throw new RangeError(`Invalid market close time: ${value}`);
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);

  if (hours > 23 || minutes > 59) {
    throw new RangeError(`Invalid market close time: ${value}`);
  }

  return hours * 60 + minutes;
}

function isCalendarCovered(calendarDate: string) {
  return (
    calendarDate >= calendar.coverage.start &&
    calendarDate <= calendar.coverage.end
  );
}

function weekdayForCalendarDate(calendarDate: string) {
  const { day, month, year } = parseCalendarDate(calendarDate);

  return weekdayNames[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function isWeekend(calendarDate: string) {
  const weekday = weekdayForCalendarDate(calendarDate);

  return weekday === "Sat" || weekday === "Sun";
}

function newYorkParts(date: Date): NewYorkDateTimeParts {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("A valid instant is required.");
  }

  const parts = Object.fromEntries(
    newYorkFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    calendarDate: `${parts.year}-${parts.month}-${parts.day}`,
    easternMinutes:
      Number.parseInt(parts.hour ?? "0", 10) * 60 +
      Number.parseInt(parts.minute ?? "0", 10),
    weekday: parts.weekday ?? "",
  };
}

function newYorkLocalTimeToInstant(calendarDate: string, minutes: number) {
  const { day, month, year } = parseCalendarDate(calendarDate);
  const hours = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const targetAsUtc = Date.UTC(year, month - 1, day, hours, minute);
  let candidate = targetAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = newYorkParts(new Date(candidate));
    const parsed = parseCalendarDate(parts.calendarDate);
    const representedAsUtc = Date.UTC(
      parsed.year,
      parsed.month - 1,
      parsed.day,
      Math.floor(parts.easternMinutes / 60),
      parts.easternMinutes % 60,
    );
    const correction = targetAsUtc - representedAsUtc;

    candidate += correction;

    if (correction === 0) {
      break;
    }
  }

  const resolved = newYorkParts(new Date(candidate));

  if (
    resolved.calendarDate !== calendarDate ||
    resolved.easternMinutes !== minutes
  ) {
    throw new RangeError(
      `Unable to resolve ${calendarDate} at ${minutes} minutes in ` +
      `${calendar.timeZone}.`,
    );
  }

  return new Date(candidate);
}

function sessionForDate(calendarDate: string): UsEquitiesSession | null {
  if (
    !isCalendarCovered(calendarDate) ||
    isWeekend(calendarDate) ||
    closures.has(calendarDate)
  ) {
    return null;
  }

  const earlyClose = earlyCloses.get(calendarDate);
  const closeMinutes = earlyClose
    ? parseClockMinutes(earlyClose.close)
    : REGULAR_CLOSE_MINUTES;

  return {
    closeAt: newYorkLocalTimeToInstant(
      calendarDate,
      closeMinutes,
    ).toISOString(),
    closeMinutes,
    date: calendarDate,
    name: earlyClose?.name ?? null,
    openAt: newYorkLocalTimeToInstant(
      calendarDate,
      REGULAR_OPEN_MINUTES,
    ).toISOString(),
    openMinutes: REGULAR_OPEN_MINUTES,
    sessionType: earlyClose ? "early_close" : "regular",
  };
}

function findSession(
  calendarDate: string,
  direction: 1 | -1,
  includeStart: boolean,
) {
  for (let offset = includeStart ? 0 : 1; offset <= 10; offset += 1) {
    const candidate = addCalendarDays(calendarDate, offset * direction);
    const session = sessionForDate(candidate);

    if (session) {
      return session;
    }

    if (!isCalendarCovered(candidate)) {
      return null;
    }
  }

  return null;
}

export function getUsEquitiesMarketState(
  date = new Date(),
): UsEquitiesMarketState {
  const parts = newYorkParts(date);
  const calendarCovered = isCalendarCovered(parts.calendarDate);
  const session = sessionForDate(parts.calendarDate);
  const holidayName = closures.get(parts.calendarDate) ?? null;
  const instantMs = date.getTime();
  const openMs = session ? new Date(session.openAt).getTime() : null;
  const closeMs = session ? new Date(session.closeAt).getTime() : null;
  const isOpen =
    openMs != null &&
    closeMs != null &&
    instantMs >= openMs &&
    instantMs < closeMs;
  const nextSession =
    session && closeMs != null && instantMs < closeMs
      ? session
      : findSession(parts.calendarDate, 1, false);
  const isClosedDay = !session;
  const isWeekendPrewarm =
    calendarCovered &&
    isClosedDay &&
    parts.easternMinutes >= PREWARM_OPEN_MINUTES &&
    parts.easternMinutes < PREWARM_CLOSE_MINUTES &&
    nextSession != null &&
    new Date(nextSession.openAt).getTime() - instantMs <= PREWARM_MAX_LEAD_MS;
  const phase = !calendarCovered
    ? "calendar_unavailable"
    : !session
      ? "closed"
      : isOpen
        ? "open"
        : openMs != null && instantMs < openMs
          ? "pre_market"
          : "after_hours";

  return {
    calendarCovered,
    calendarDate: parts.calendarDate,
    closeAt: session?.closeAt ?? null,
    closeMinutes: session?.closeMinutes ?? null,
    easternMinutes: parts.easternMinutes,
    holidayName,
    isMarketDay: session != null,
    isOpen,
    isWeekendPrewarm,
    nextSession,
    openAt: session?.openAt ?? null,
    openMinutes: session?.openMinutes ?? null,
    phase,
    sessionType: session?.sessionType ?? "closed",
    weekday: parts.weekday,
  };
}

export function getNextUsEquitiesRefreshAt(
  date: Date,
  freshnessMs: number,
) {
  if (!Number.isFinite(freshnessMs) || freshnessMs <= 0) {
    throw new RangeError("Freshness duration must be positive.");
  }

  const state = getUsEquitiesMarketState(date);

  if (!state.calendarCovered) {
    return null;
  }

  if (state.isOpen && state.closeAt) {
    return new Date(
      Math.min(
        date.getTime() + freshnessMs,
        new Date(state.closeAt).getTime(),
      ),
    ).toISOString();
  }

  if (state.phase === "pre_market" && state.openAt) {
    return state.openAt;
  }

  return state.nextSession?.openAt ?? null;
}

export function getEquityOptionExpirationAt(expirationDate: string) {
  if (!isCalendarCovered(expirationDate)) {
    throw new RangeError(
      `Option expiration ${expirationDate} is outside the maintained ` +
      `US equities calendar (${calendar.coverage.start} through ` +
      `${calendar.coverage.end}).`,
    );
  }

  const session = findSession(expirationDate, -1, true);

  if (!session) {
    throw new RangeError(
      `No covered US equities session exists for ${expirationDate}.`,
    );
  }

  return new Date(session.closeAt);
}
