import { describe, expect, it } from "vitest";
import {
  parseBrokerStatementCsv,
  parseRobinhoodStatementCsv,
  parseRobinhoodOptionDescription,
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
        "AAPL 6/26/2026 Put $200.00",
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
      optionActivity: {
        action: "open_short",
        effect: "open",
        side: "short",
      },
      optionContract: {
        expirationDate: "2026-06-26",
        optionType: "put",
        strike: 200,
        underlying: "AAPL",
      },
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
        "SPY 6/26/2026 Call $450.00",
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
    expect(result.rows[0].status).toBe("needs_review");
    expect(result.rows[0].errors).toContain("Unsupported Robinhood option description.");
  });

  it.each([
    ["STO", "option", "staged", "NVDA 6/26/2026 Put $200.00"],
    ["BTC", "option", "staged", "NVDA 6/26/2026 Put $200.00"],
    ["BTO", "option", "staged", "NVDA 6/26/2026 Call $200.00"],
    ["STC", "option", "staged", "NVDA 6/26/2026 Call $200.00"],
    ["Buy", "equity", "staged"],
    ["Sell", "equity", "staged"],
    ["CDIV", "dividend", "staged"],
    ["OEXP", "option", "staged", "NVDA 6/26/2026 Put $200.00"],
    ["ACH", "out_of_scope", "ignored"],
    ["XENT", "out_of_scope", "ignored"],
    ["INT", "out_of_scope", "ignored"],
    ["FUTSWP", "out_of_scope", "ignored"],
    ["GDBP", "out_of_scope", "ignored"],
  ] as const)("classifies Robinhood trans code %s", (
    transCode,
    classification,
    status,
    description = "Broker row",
  ) => {
    const result = parseRobinhoodStatementCsv([
      header,
      csvRow([
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "AAPL",
        description,
        transCode,
        "1",
        "$1.00",
        "$100.00",
      ]),
    ].join("\n"));

    expect(result.rows[0]).toMatchObject({ classification, status, transCode });
  });

  it("normalizes Robinhood put and call option descriptions", () => {
    expect(parseRobinhoodOptionDescription("NVDA 6/26/2026 Put $200.00")).toEqual({
      expirationDate: "2026-06-26",
      optionType: "put",
      strike: 200,
      underlying: "NVDA",
    });

    expect(parseRobinhoodOptionDescription("spy 2026-07-17 Call $1,000.50")).toEqual({
      expirationDate: "2026-07-17",
      optionType: "call",
      strike: 1000.5,
      underlying: "SPY",
    });

    expect(parseRobinhoodOptionDescription("Option Expiration for CIFR 4/10/2026 Put $13.50")).toEqual({
      expirationDate: "2026-04-10",
      optionType: "put",
      strike: 13.5,
      underlying: "CIFR",
    });
  });

  it("skips Robinhood disclaimer rows with data only beyond known headers", () => {
    const result = parseRobinhoodStatementCsv([
      header,
      csvRow([
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "AAPL",
        "AAPL 6/26/2026 Put $200.00",
        "STO",
        "1",
        "$1.00",
        "$100.00",
      ]),
      `"","","","","","","","","","The data provided is for informational purposes only."`,
    ].join("\n"));

    expect(result.rows).toHaveLength(1);
  });

  it.each([
    ["STO", "open_short", "open", "short"],
    ["BTC", "close_short", "close", "short"],
    ["BTO", "open_long", "open", "long"],
    ["STC", "close_long", "close", "long"],
    ["OEXP", "expire", "expire", null],
  ] as const)("normalizes option activity for %s", (transCode, action, effect, side) => {
    const result = parseRobinhoodStatementCsv([
      header,
      csvRow([
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        transCode,
        "1",
        "$1.25",
        "$125.00",
      ]),
    ].join("\n"));

    expect(result.rows[0].optionActivity).toEqual({ action, effect, side });
    expect(result.rows[0].optionContract).toEqual({
      expirationDate: "2026-06-26",
      optionType: "put",
      strike: 200,
      underlying: "NVDA",
    });
    expect(result.rows[0]).toMatchObject({
      amount: 125,
      price: 1.25,
    });
  });

  it("marks unsupported option descriptions for review without dropping cash movement", () => {
    const result = parseRobinhoodStatementCsv([
      header,
      csvRow([
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "Unsupported option memo",
        "STO",
        "1",
        "$1.25",
        "$125.00",
      ]),
    ].join("\n"));

    expect(result.rows[0]).toMatchObject({
      amount: 125,
      classification: "option",
      optionContract: null,
      price: 1.25,
      status: "needs_review",
    });
    expect(result.rows[0].errors).toContain("Unsupported Robinhood option description.");
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
        "AAPL 6/26/2026 Put $200.00",
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
