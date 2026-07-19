import { createHash } from "node:crypto";
import type { StatementImportBroker, StatementImportRow } from "./statement-import-adapters";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = value[key];
        return accumulator;
      }, {}),
  );
}

export function statementImportFileHash(
  broker: StatementImportBroker,
  csv: string,
) {
  return sha256(`${broker}:${csv.replace(/\r\n/g, "\n").trim()}`);
}

export function statementImportRowHash(
  broker: StatementImportBroker,
  row: StatementImportRow,
) {
  return sha256(`${broker}:${stableJson(row.rawRow)}`);
}

export function statementImportPositionFingerprint(
  broker: StatementImportBroker,
  rows: StatementImportRow[],
  rowIndexes: number[],
) {
  const rowsByIndex = new Map(rows.map((row) => [row.rowIndex, row]));
  const rowHashes = rowIndexes.map((rowIndex) => {
    const row = rowsByIndex.get(rowIndex);

    if (!row) {
      throw new Error(`Statement import row ${rowIndex} was not found.`);
    }

    return statementImportRowHash(broker, row);
  }).sort();

  return sha256(`${broker}:position:${rowHashes.join("|")}`);
}

export function statementImportEquityLotFingerprint(
  broker: StatementImportBroker,
  row: StatementImportRow,
  occurrence: number,
) {
  return sha256(
    `${broker}:equity-lot:${statementImportRowHash(broker, row)}:${occurrence}`,
  );
}

export function duplicateStatementRowHashes(
  broker: StatementImportBroker,
  rows: StatementImportRow[],
  existingHashes = new Set<string>(),
) {
  const seen = new Set(existingHashes);
  const duplicates = new Set<string>();

  for (const row of rows) {
    const hash = statementImportRowHash(broker, row);

    if (seen.has(hash)) {
      duplicates.add(hash);
    }

    seen.add(hash);
  }

  return duplicates;
}
