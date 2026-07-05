import { describe, expect, it } from "vitest";
import {
  parseBrokerStatementCsv,
  parseRobinhoodStatementCsv,
  StatementImportAdapterError,
} from "./statement-import-adapters";

const header = [
  "Activity Date",
  "Process Date",
  "Settle Date",
  "Instrument",
  "Description",
  "Trans Code",
  "Quantity",
  "Price",
  "Amount",
].join(",");

function csvRow(values: string[]) {
  return values.map((value) => `"${value.replaceAll("\"", "\"\"")}"`).join(",");
}

describe("broker statement import adapters", () => {
  it("selects the Robinhood adapter for the expected CSV shape", () => {
    const result = parseBrokerStatementCsv([
      header,
      csvRow([
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "AAPL",
        "Apple option order",
        "STO",
        "1",
        "$1.25",
        "$125.00",
      ]),
    ].join("\n"));

    expect(result.broker).toBe("robinhood");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      activityDate: "2026-06-01",
      amount: 125,
      classification: "option",
      price: 1.25,
      quantity: 1,
      status: "staged",
      transCode: "STO",
    });
  });

  it("rejects Robinhood-shaped CSVs with clear missing-column errors", () => {
    expect(() => parseBrokerStatementCsv([
      "Activity Date,Instrument,Description,Trans Code,Amount",
      "6/1/2026,AAPL,Apple option order,STO,$125.00",
    ].join("\n"))).toThrow(StatementImportAdapterError);

    try {
      parseBrokerStatementCsv([
        "Activity Date,Instrument,Description,Trans Code,Amount",
        "6/1/2026,AAPL,Apple option order,STO,$125.00",
      ].join("\n"));
    } catch (error) {
      expect(error).toBeInstanceOf(StatementImportAdapterError);
      expect((error as StatementImportAdapterError).code).toBe("MISSING_REQUIRED_COLUMNS");
      expect((error as StatementImportAdapterError).message).toContain("Process Date");
      expect((error as StatementImportAdapterError).message).toContain("Quantity");
    }
  });

  it("parses parenthesized and comma-formatted currency values", () => {
    const result = parseRobinhoodStatementCsv([
      header,
      csvRow([
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "SPY",
        "Buyback",
        "BTC",
        "1",
        "$12.34",
        "($1,234.56)",
      ]),
    ].join("\n"));

    expect(result.rows[0]).toMatchObject({
      amount: -1234.56,
      price: 12.34,
    });
  });

  it("handles multiline descriptions inside quoted CSV fields", () => {
    const result = parseRobinhoodStatementCsv([
      header,
      csvRow([
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "MSFT",
        "Option assignment notice\nsecond line",
        "OEXP",
        "1",
        "$0.00",
        "$0.00",
      ]),
    ].join("\n"));

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].description).toBe("Option assignment notice\nsecond line");
    expect(result.rows[0].classification).toBe("option");
  });

  it.each([
    ["STO", "option", "staged"],
    ["BTC", "option", "staged"],
    ["BTO", "option", "staged"],
    ["STC", "option", "staged"],
    ["Buy", "equity", "staged"],
    ["Sell", "equity", "staged"],
    ["CDIV", "dividend", "staged"],
    ["OEXP", "option", "staged"],
    ["ACH", "out_of_scope", "ignored"],
    ["XENT", "out_of_scope", "ignored"],
    ["INT", "out_of_scope", "ignored"],
    ["FUTSWP", "out_of_scope", "ignored"],
  ] as const)("classifies Robinhood trans code %s", (transCode, classification, status) => {
    const result = parseRobinhoodStatementCsv([
      header,
      csvRow([
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "AAPL",
        "Broker row",
        transCode,
        "1",
        "$1.00",
        "$100.00",
      ]),
    ].join("\n"));

    expect(result.rows[0]).toMatchObject({ classification, status, transCode });
  });

  it("marks unsupported rows for review without failing the import", () => {
    const result = parseRobinhoodStatementCsv([
      header,
      csvRow([
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "DOGE",
        "Unsupported crypto row",
        "CRYPTO",
        "1",
        "$1.00",
        "$1.00",
      ]),
      csvRow([
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "AAPL",
        "Supported option row",
        "STO",
        "1",
        "$1.00",
        "$100.00",
      ]),
    ].join("\n"));

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      classification: "unknown",
      status: "needs_review",
    });
    expect(result.rows[0].errors[0]).toContain("Unsupported Robinhood transaction code");
    expect(result.rows[1]).toMatchObject({
      classification: "option",
      status: "staged",
    });
  });
});

