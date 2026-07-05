export type StatementImportBroker = "robinhood";

export type StatementImportClassification =
  | "cash"
  | "dividend"
  | "equity"
  | "ignored"
  | "option"
  | "out_of_scope"
  | "unknown";

export type StatementImportRowStatus =
  | "failed"
  | "ignored"
  | "imported"
  | "needs_review"
  | "staged";

export type OptionActivityAction =
  | "close_long"
  | "close_short"
  | "expire"
  | "open_long"
  | "open_short";

export interface StatementImportOptionContract {
  expirationDate: string;
  optionType: "call" | "put";
  strike: number;
  underlying: string;
}

export interface StatementImportOptionActivity {
  action: OptionActivityAction;
  effect: "close" | "expire" | "open";
  side: "long" | "short" | null;
}

export interface StatementImportRow {
  activityDate: string | null;
  amount: number | null;
  classification: StatementImportClassification;
  confidence: number | null;
  description: string | null;
  errors: string[];
  instrument: string | null;
  optionActivity: StatementImportOptionActivity | null;
  optionContract: StatementImportOptionContract | null;
  price: number | null;
  processDate: string | null;
  quantity: number | null;
  rawRow: Record<string, string>;
  rowIndex: number;
  settleDate: string | null;
  status: StatementImportRowStatus;
  transCode: string | null;
}

export interface StatementImportParseResult {
  broker: StatementImportBroker;
  rows: StatementImportRow[];
}

export interface StatementImportAdapter {
  broker: StatementImportBroker;
  detect(headers: string[]): boolean;
  parse(csv: string): StatementImportParseResult;
  validate(headers: string[]): void;
}

interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
}

interface ClassificationResult {
  classification: StatementImportClassification;
  confidence: number;
  status: StatementImportRowStatus;
  errors?: string[];
}

export class StatementImportAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "StatementImportAdapterError";
  }
}

const ROBINHOOD_REQUIRED_COLUMNS = [
  "Activity Date",
  "Process Date",
  "Settle Date",
  "Instrument",
  "Description",
  "Trans Code",
  "Quantity",
  "Price",
  "Amount",
] as const;

const ROBINHOOD_SIGNATURE_COLUMNS = [
  "Activity Date",
  "Instrument",
  "Description",
  "Trans Code",
  "Amount",
] as const;

const optionTransCodes = new Set(["BTO", "BTC", "STC", "STO", "OEXP"]);
const equityTransCodes = new Set(["BUY", "SELL"]);
const dividendTransCodes = new Set(["CDIV"]);
const outOfScopeTransCodes = new Set(["ACH", "XENT", "INT", "FUTSWP"]);

const optionActivityByTransCode = {
  BTC: { action: "close_short", effect: "close", side: "short" },
  BTO: { action: "open_long", effect: "open", side: "long" },
  OEXP: { action: "expire", effect: "expire", side: null },
  STC: { action: "close_long", effect: "close", side: "long" },
  STO: { action: "open_short", effect: "open", side: "short" },
} as const satisfies Record<string, StatementImportOptionActivity>;

function normalizeHeader(header: string) {
  return header.replace(/^\uFEFF/, "").trim();
}

function normalizeTransCode(value: string | null) {
  return value?.trim().toUpperCase() ?? "";
}

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function parseCsvRecords(csv: string) {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      record.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      record.push(field);
      if (record.some((cell) => cell.length > 0)) {
        records.push(record);
      }
      field = "";
      record = [];
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new StatementImportAdapterError(
      "MALFORMED_CSV",
      "CSV contains an unterminated quoted field.",
    );
  }

  record.push(field);
  if (record.some((cell) => cell.length > 0)) {
    records.push(record);
  }

  return records;
}

function parseCsv(csv: string): CsvParseResult {
  const records = parseCsvRecords(csv);

  if (records.length === 0) {
    throw new StatementImportAdapterError("EMPTY_CSV", "CSV file is empty.");
  }

  const headers = records[0].map(normalizeHeader);

  if (headers.length === 0 || headers.every((header) => header.length === 0)) {
    throw new StatementImportAdapterError("EMPTY_HEADER", "CSV header row is empty.");
  }

  const rows = records.slice(1).map((record) => {
    const rawRow: Record<string, string> = {};

    headers.forEach((header, index) => {
      rawRow[header] = record[index]?.trim() ?? "";
    });

    return rawRow;
  });

  return { headers, rows };
}

function missingColumns(headers: string[]) {
  const headerSet = new Set(headers);
  return ROBINHOOD_REQUIRED_COLUMNS.filter((column) => !headerSet.has(column));
}

function looksLikeRobinhood(headers: string[]) {
  const headerSet = new Set(headers);
  return ROBINHOOD_SIGNATURE_COLUMNS.filter((column) => headerSet.has(column)).length >= 3;
}

function validateRobinhoodHeaders(headers: string[]) {
  const missing = missingColumns(headers);

  if (missing.length > 0) {
    throw new StatementImportAdapterError(
      "MISSING_REQUIRED_COLUMNS",
      `Robinhood CSV is missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
      { missingColumns: missing },
    );
  }
}

function parseDate(value: string | null) {
  if (!value) {
    return null;
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoMatch) {
    return value;
  }

  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!slashMatch) {
    return null;
  }

  const month = Number(slashMatch[1]);
  const day = Number(slashMatch[2]);
  const year = Number(slashMatch[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function parseNumber(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const isParenthesizedNegative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const withoutParentheses = isParenthesizedNegative ? trimmed.slice(1, -1) : trimmed;
  const cleaned = withoutParentheses.replace(/[$,%\s,]/g, "");
  const parsed = Number(cleaned);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return isParenthesizedNegative ? -Math.abs(parsed) : parsed;
}

export function parseRobinhoodOptionDescription(
  description: string | null,
): StatementImportOptionContract | null {
  if (!description) {
    return null;
  }

  const match = /^\s*([A-Z][A-Z0-9.-]*)\s+(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\s+(Put|Call)\s+\$?([0-9,]+(?:\.\d+)?)\s*$/i.exec(description);

  if (!match) {
    return null;
  }

  const expirationDate = parseDate(match[2]);
  const strike = parseNumber(match[4]);

  if (expirationDate == null || strike == null || strike <= 0) {
    return null;
  }

  return {
    expirationDate,
    optionType: match[3].toLowerCase() as "call" | "put",
    strike,
    underlying: match[1].toUpperCase(),
  };
}

function optionActivityForTransCode(transCode: string | null) {
  const normalizedCode = normalizeTransCode(transCode);
  return optionActivityByTransCode[normalizedCode as keyof typeof optionActivityByTransCode] ?? null;
}

function classifyRobinhoodRow(transCode: string | null): ClassificationResult {
  const normalizedCode = normalizeTransCode(transCode);

  if (optionTransCodes.has(normalizedCode)) {
    return { classification: "option", confidence: 0.95, status: "staged" };
  }

  if (equityTransCodes.has(normalizedCode)) {
    return { classification: "equity", confidence: 0.95, status: "staged" };
  }

  if (dividendTransCodes.has(normalizedCode)) {
    return { classification: "dividend", confidence: 0.95, status: "staged" };
  }

  if (outOfScopeTransCodes.has(normalizedCode)) {
    return { classification: "out_of_scope", confidence: 0.95, status: "ignored" };
  }

  return {
    classification: "unknown",
    confidence: 0.25,
    errors: [`Unsupported Robinhood transaction code: ${transCode || "(blank)"}.`],
    status: "needs_review",
  };
}

function parseRobinhoodRow(rawRow: Record<string, string>, rowIndex: number): StatementImportRow {
  const activityDate = parseDate(nonEmpty(rawRow["Activity Date"]));
  const processDate = parseDate(nonEmpty(rawRow["Process Date"]));
  const settleDate = parseDate(nonEmpty(rawRow["Settle Date"]));
  const transCode = nonEmpty(rawRow["Trans Code"]);
  const classification = classifyRobinhoodRow(transCode);
  const errors = [...(classification.errors ?? [])];
  const description = nonEmpty(rawRow.Description);
  const optionActivity = classification.classification === "option"
    ? optionActivityForTransCode(transCode)
    : null;
  const optionContract = classification.classification === "option"
    ? parseRobinhoodOptionDescription(description)
    : null;

  if (nonEmpty(rawRow["Activity Date"]) && activityDate == null) {
    errors.push("Invalid activity date.");
  }

  if (nonEmpty(rawRow["Process Date"]) && processDate == null) {
    errors.push("Invalid process date.");
  }

  if (nonEmpty(rawRow["Settle Date"]) && settleDate == null) {
    errors.push("Invalid settle date.");
  }

  if (classification.classification === "option" && optionContract == null) {
    errors.push("Unsupported Robinhood option description.");
  }

  const status = errors.length > 0 && classification.status === "staged"
    ? "needs_review"
    : classification.status;

  return {
    activityDate,
    amount: parseNumber(nonEmpty(rawRow.Amount)),
    classification: classification.classification,
    confidence: classification.confidence,
    description,
    errors,
    instrument: nonEmpty(rawRow.Instrument),
    optionActivity,
    optionContract,
    price: parseNumber(nonEmpty(rawRow.Price)),
    processDate,
    quantity: parseNumber(nonEmpty(rawRow.Quantity)),
    rawRow,
    rowIndex,
    settleDate,
    status,
    transCode,
  };
}

export function parseRobinhoodStatementCsv(csv: string): StatementImportParseResult {
  const parsed = parseCsv(csv);
  validateRobinhoodHeaders(parsed.headers);

  return {
    broker: "robinhood",
    rows: parsed.rows.map((rawRow, rowIndex) => parseRobinhoodRow(rawRow, rowIndex)),
  };
}

export const robinhoodStatementImportAdapter: StatementImportAdapter = {
  broker: "robinhood",
  detect: looksLikeRobinhood,
  parse: parseRobinhoodStatementCsv,
  validate: validateRobinhoodHeaders,
};

export const supportedStatementImportAdapters = [
  robinhoodStatementImportAdapter,
] as const satisfies readonly StatementImportAdapter[];

export function parseBrokerStatementCsv(csv: string): StatementImportParseResult {
  const parsed = parseCsv(csv);
  const adapter = supportedStatementImportAdapters.find((candidate) =>
    candidate.detect(parsed.headers)
  );

  if (adapter) {
    return adapter.parse(csv);
  }

  throw new StatementImportAdapterError(
    "UNSUPPORTED_BROKER_FORMAT",
    "CSV file does not match a supported broker statement format.",
  );
}
