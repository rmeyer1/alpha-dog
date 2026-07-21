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

export function duplicateStatementRowIndexes(
  broker: StatementImportBroker,
  rows: StatementImportRow[],
  existingHashes = new Set<string>(),
) {
  const seen = new Set(existingHashes);
  const duplicateIndexes = new Set<number>();

  for (const row of rows) {
    const hash = statementImportRowHash(broker, row);

    if (seen.has(hash)) {
      duplicateIndexes.add(row.rowIndex);
    }

    seen.add(hash);
  }

  return duplicateIndexes;
}
