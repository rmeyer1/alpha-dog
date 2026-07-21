import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  StatementImportBroker,
  StatementImportRow,
  StatementImportRowStatus,
} from "./statement-import-adapters";
import {
  duplicateStatementRowIndexes,
  statementImportFileHash,
  statementImportRowHash,
} from "./statement-import-fingerprints";
import {
  reconcileImportedOptionRows,
  type OptionReconciliationGroup,
} from "./statement-import-reconciliation";
import {
  buildStatementImportWritePlan,
  writeStatementImportToPaperAccount,
} from "./statement-import-write";

type ImportStatus = "failed" | "imported" | "needs_review" | "parsed" | "uploaded";
type ReviewDecision = "confirmed" | "rejected";

interface PersistedImport {
  broker: StatementImportBroker;
  file_hash: string;
  file_name: string;
  id: string;
  status: ImportStatus;
  summary: Record<string, unknown>;
}

interface PersistedRow {
  activity_date: string | null;
  amount: number | string | null;
  classification: StatementImportRow["classification"];
  confidence: number | string | null;
  description: string | null;
  id: string;
  instrument: string | null;
  price: number | string | null;
  process_date: string | null;
  quantity: number | string | null;
  raw_row: Record<string, string>;
  row_hash: string;
  row_index: number;
  settle_date: string | null;
  status: StatementImportRowStatus | "duplicate";
  trans_code: string | null;
}

interface PersistedGroup {
  confidence: number | string | null;
  id: string;
  metadata: OptionReconciliationGroup & {
    audit?: { at: string; decision: ReviewDecision; userId: string }[];
  };
  status: "confirmed" | "failed" | "ignored" | "imported" | "needs_review" | "rejected" | "staged";
  strategy_type: string | null;
  symbol: string | null;
}

export interface StatementImportReviewGroupResponse {
  canConfirm: boolean;
  confidence: number;
  decision: ReviewDecision | null;
  explanation: string[];
  groupId: string;
  groupKey: string;
  reviewReason: string | null;
  sourceRowIndexes: number[];
  status: PersistedGroup["status"];
  strategyType: string;
  symbol: string | null;
}

export class StatementImportReviewDecisionError extends Error {
  readonly code = "STATEMENT_IMPORT_GROUP_NOT_CONFIRMABLE";
}

export interface StatementImportSummary {
  dividendsTracked: number;
  duplicateRows: number;
  equityLots: number;
  excludedRows: number;
  failedRecords: number;
  ignoredRows: number;
  importedRecords: number;
  insertedEquityLots: number;
  insertedEvents: number;
  insertedPositions: number;
  optionPositions: number;
  rejectedGroups: number;
  reviewGroups: number;
  skippedDuplicates: number;
  stagedRows: number;
}

export interface StatementImportResponse {
  broker: StatementImportBroker;
  fileHash: string;
  fileName: string;
  importId: string;
  isDuplicate: boolean;
  reviewGroups: StatementImportReviewGroupResponse[];
  status: ImportStatus;
  summary: StatementImportSummary;
}

function numericValue(value: number | string | null) {
  return value == null ? null : Number(value);
}

function rowStatus(row: StatementImportRow, isDuplicate: boolean): StatementImportRowStatus | "duplicate" {
  if (isDuplicate) {
    return "duplicate";
  }

  if (row.status === "needs_review") {
    return "needs_review";
  }

  if (row.classification === "cash" || row.classification === "out_of_scope" || row.classification === "ignored") {
    return "ignored";
  }

  return "staged";
}

function rowForDatabase(
  importId: string,
  userId: string,
  broker: StatementImportBroker,
  row: StatementImportRow,
  duplicateRowIndexes: Set<number>,
) {
  const rowHash = statementImportRowHash(broker, row);

  return {
    activity_date: row.activityDate,
    amount: row.amount,
    classification: row.classification,
    confidence: row.confidence,
    description: row.description,
    import_id: importId,
    instrument: row.instrument,
    price: row.price,
    process_date: row.processDate,
    quantity: row.quantity,
    raw_row: row.rawRow,
    row_hash: rowHash,
    row_index: row.rowIndex,
    settle_date: row.settleDate,
    status: rowStatus(row, duplicateRowIndexes.has(row.rowIndex)),
    trans_code: row.transCode,
    user_id: userId,
  };
}

function canConfirmGroup(metadata: OptionReconciliationGroup) {
  return metadata.legs.length > 0 && metadata.events.length > 0 && metadata.groupKey.length > 0;
}

function confirmedGroupMetadata(metadata: PersistedGroup["metadata"]) {
  if (!canConfirmGroup(metadata)) {
    throw new StatementImportReviewDecisionError(
      "This review group does not contain enough normalized option data to confirm. Reject it instead.",
    );
  }

  return {
    ...metadata,
    paperPositionKey: metadata.paperPositionKey ?? `${metadata.groupKey}:position`,
    status: "confirmed" as const,
  };
}

function groupStatus(group: OptionReconciliationGroup) {
  return group.status === "ignored" ? "ignored" : group.status;
}

function strategyTypeForDatabase(group: OptionReconciliationGroup) {
  if (
    group.strategyType === "call_credit_spread" ||
    group.strategyType === "put_credit_spread" ||
    group.strategyType === "short_put"
  ) {
    return group.strategyType;
  }

  return "custom";
}

function groupForDatabase(importId: string, userId: string, group: OptionReconciliationGroup) {
  return {
    confidence: group.confidence,
    group_type: "option_strategy",
    import_id: importId,
    metadata: group,
    status: groupStatus(group),
    strategy_type: strategyTypeForDatabase(group),
    symbol: group.symbol,
    user_id: userId,
  };
}

function summaryDefaults(partial: Partial<StatementImportSummary> = {}): StatementImportSummary {
  return {
    dividendsTracked: 0,
    duplicateRows: 0,
    equityLots: 0,
    excludedRows: 0,
    failedRecords: 0,
    ignoredRows: 0,
    importedRecords: 0,
    insertedEquityLots: 0,
    insertedEvents: 0,
    insertedPositions: 0,
    optionPositions: 0,
    rejectedGroups: 0,
    reviewGroups: 0,
    skippedDuplicates: 0,
    stagedRows: 0,
    ...partial,
  };
}

function responseGroup(group: PersistedGroup): StatementImportReviewGroupResponse {
  const metadata = group.metadata;
  const decision = group.status === "confirmed" || group.status === "rejected"
    ? group.status
    : null;

  return {
    canConfirm: canConfirmGroup(metadata),
    confidence: Number(group.confidence ?? metadata.confidence ?? 0),
    decision,
    explanation: metadata.explanation ?? [],
    groupId: group.id,
    groupKey: metadata.groupKey,
    reviewReason: metadata.reviewReason,
    sourceRowIndexes: metadata.sourceRowIndexes ?? [],
    status: group.status,
    strategyType: metadata.strategyType,
    symbol: metadata.symbol,
  };
}

export function buildStatementImportStagingPlan(
  broker: StatementImportBroker,
  rows: StatementImportRow[],
  groups: OptionReconciliationGroup[],
  existingHashes: Set<string>,
) {
  const duplicateRowIndexes = duplicateStatementRowIndexes(broker, rows, existingHashes);
  const stageableRows = rows.filter((row) => !duplicateRowIndexes.has(row.rowIndex));
  const stageableGroups = duplicateRowIndexes.size > 0
    ? reconcileImportedOptionRows(stageableRows)
    : groups;

  return {
    duplicateRowIndexes,
    groups: stageableGroups,
    plan: buildStatementImportWritePlan(stageableRows, stageableGroups),
    rows: stageableRows,
  };
}

function responseFromRecords(
  statementImport: PersistedImport,
  rows: PersistedRow[],
  groups: PersistedGroup[],
  isDuplicate: boolean,
): StatementImportResponse {
  const summary = summaryDefaults(statementImport.summary as Partial<StatementImportSummary>);
  const activeReviewGroups = groups.filter((group) => group.status === "needs_review");
  const rejectedGroups = groups.filter((group) => group.status === "rejected");
  const duplicateRows = rows.filter((row) => row.status === "duplicate");
  const stagedRows = rows.filter((row) => row.status === "staged" || row.status === "needs_review");

  return {
    broker: statementImport.broker,
    fileHash: statementImport.file_hash,
    fileName: statementImport.file_name,
    importId: statementImport.id,
    isDuplicate,
    reviewGroups: groups
      .filter((group) =>
        group.status === "needs_review" || group.status === "confirmed" || group.status === "rejected"
      )
      .map(responseGroup),
    status: statementImport.status,
    summary: summaryDefaults({
      ...summary,
      duplicateRows: duplicateRows.length,
      rejectedGroups: rejectedGroups.length,
      reviewGroups: activeReviewGroups.length,
      stagedRows: stagedRows.length,
    }),
  };
}

async function loadImportRecords(
  supabase: SupabaseClient,
  userId: string,
  importId: string,
) {
  const importResult = await supabase
    .from("statement_imports")
    .select("id,broker,file_name,file_hash,status,summary")
    .eq("user_id", userId)
    .eq("id", importId)
    .maybeSingle();

  if (importResult.error) {
    throw new Error("Unable to load statement import.");
  }

  if (!importResult.data) {
    return null;
  }

  const rowsResult = await supabase
    .from("statement_import_rows")
    .select("id,row_index,row_hash,raw_row,activity_date,process_date,settle_date,instrument,description,trans_code,quantity,price,amount,classification,confidence,status")
    .eq("user_id", userId)
    .eq("import_id", importId)
    .order("row_index", { ascending: true });

  if (rowsResult.error) {
    throw new Error("Unable to load statement import rows.");
  }

  const groupsResult = await supabase
    .from("statement_reconciliation_groups")
    .select("id,symbol,strategy_type,confidence,status,metadata")
    .eq("user_id", userId)
    .eq("import_id", importId)
    .order("created_at", { ascending: true });

  if (groupsResult.error) {
    throw new Error("Unable to load statement import review groups.");
  }

  return {
    groups: (groupsResult.data ?? []) as PersistedGroup[],
    import: importResult.data as PersistedImport,
    rows: (rowsResult.data ?? []) as PersistedRow[],
  };
}

export async function loadStatementImport(
  supabase: SupabaseClient,
  userId: string,
  importId: string,
): Promise<StatementImportResponse | null> {
  const records = await loadImportRecords(supabase, userId, importId);

  return records ? responseFromRecords(records.import, records.rows, records.groups, false) : null;
}

export async function createStatementImport(
  supabase: SupabaseClient,
  userId: string,
  fileName: string,
  csv: string,
  broker: StatementImportBroker,
  rows: StatementImportRow[],
  groups: OptionReconciliationGroup[],
): Promise<StatementImportResponse> {
  const fileHash = statementImportFileHash(broker, csv);
  const existingImportResult = await supabase
    .from("statement_imports")
    .select("id,broker,file_name,file_hash,status,summary")
    .eq("user_id", userId)
    .eq("broker", broker)
    .eq("file_hash", fileHash)
    .maybeSingle();

  if (existingImportResult.error) {
    throw new Error("Unable to check existing statement import.");
  }

  if (existingImportResult.data) {
    const existing = await loadImportRecords(supabase, userId, existingImportResult.data.id);

    if (!existing) {
      throw new Error("Unable to load existing statement import.");
    }

    return responseFromRecords(existing.import, existing.rows, existing.groups, true);
  }

  const rowHashes = rows.map((row) => statementImportRowHash(broker, row));
  const duplicateHashResult = rowHashes.length === 0
    ? { data: [], error: null }
    : await supabase
      .from("statement_import_rows")
      .select("row_hash")
      .eq("user_id", userId)
      .in("row_hash", rowHashes);

  if (duplicateHashResult.error) {
    throw new Error("Unable to check duplicate statement rows.");
  }

  const existingHashes = new Set(
    (duplicateHashResult.data ?? []).map((row: { row_hash: string }) => row.row_hash),
  );
  const stagingPlan = buildStatementImportStagingPlan(broker, rows, groups, existingHashes);
  const plan = stagingPlan.plan;
  const status: ImportStatus = plan.summary.reviewGroups > 0 ? "needs_review" : "parsed";
  const baseSummary = summaryDefaults({
    dividendsTracked: plan.summary.dividendsTracked,
    duplicateRows: stagingPlan.duplicateRowIndexes.size,
    equityLots: plan.summary.equityLots,
    excludedRows: plan.summary.excludedRows,
    ignoredRows: plan.summary.excludedRows,
    optionPositions: plan.summary.optionPositions,
    reviewGroups: plan.summary.reviewGroups,
    stagedRows: stagingPlan.rows.length,
  });
  const importResult = await supabase
    .from("statement_imports")
    .insert({
      broker,
      file_hash: fileHash,
      file_name: fileName,
      status,
      summary: baseSummary,
      user_id: userId,
    })
    .select("id,broker,file_name,file_hash,status,summary")
    .single();

  if (importResult.error || !importResult.data) {
    throw new Error("Unable to create statement import.");
  }

  const statementImport = importResult.data as PersistedImport;
  const rowsForInsert = rows.map((row) =>
    rowForDatabase(statementImport.id, userId, broker, row, stagingPlan.duplicateRowIndexes)
  );
  const groupsForInsert = stagingPlan.groups.map((group) =>
    groupForDatabase(statementImport.id, userId, group)
  );

  try {
    let insertedRows: { id: string; row_index: number }[] = [];

    if (rowsForInsert.length > 0) {
      const rowsResult = await supabase
        .from("statement_import_rows")
        .insert(rowsForInsert)
        .select("id,row_index");

      if (rowsResult.error) {
        throw new Error("Unable to stage statement import rows.");
      }

      insertedRows = (rowsResult.data ?? []) as { id: string; row_index: number }[];
    }

    let insertedGroups: { id: string; metadata: OptionReconciliationGroup }[] = [];

    if (groupsForInsert.length > 0) {
      const groupsResult = await supabase
        .from("statement_reconciliation_groups")
        .insert(groupsForInsert)
        .select("id,metadata");

      if (groupsResult.error) {
        throw new Error("Unable to stage statement import review groups.");
      }

      insertedGroups = (groupsResult.data ?? []) as { id: string; metadata: OptionReconciliationGroup }[];
    }

    const rowIdsByIndex = new Map(insertedRows.map((row) => [row.row_index, row.id]));
    const groupRows = insertedGroups.flatMap((group) =>
      (group.metadata.sourceRowIndexes ?? []).flatMap((rowIndex) => {
        const rowId = rowIdsByIndex.get(rowIndex);

        return rowId ? [{ group_id: group.id, role: "source", row_id: rowId }] : [];
      })
    );

    if (groupRows.length > 0) {
      const membershipResult = await supabase
        .from("statement_reconciliation_group_rows")
        .insert(groupRows);

      if (membershipResult.error) {
        throw new Error("Unable to link statement import rows to review groups.");
      }
    }
  } catch (error) {
    const cleanupResult = await supabase
      .from("statement_imports")
      .delete()
      .eq("user_id", userId)
      .eq("id", statementImport.id);

    if (cleanupResult.error) {
      throw new Error("Unable to clean up an incomplete statement import.", { cause: error });
    }

    throw error;
  }

  if (plan.summary.reviewGroups === 0) {
    return finalizeStatementImport(supabase, userId, statementImport.id);
  }

  const loaded = await loadStatementImport(supabase, userId, statementImport.id);

  if (!loaded) {
    throw new Error("Unable to load staged statement import.");
  }

  return loaded;
}

export async function decideStatementImportGroup(
  supabase: SupabaseClient,
  userId: string,
  importId: string,
  groupId: string,
  decision: ReviewDecision,
): Promise<StatementImportResponse> {
  const status = decision === "confirmed" ? "confirmed" : "rejected";
  const existingResult = await supabase
    .from("statement_reconciliation_groups")
    .select("metadata,status")
    .eq("user_id", userId)
    .eq("import_id", importId)
    .eq("id", groupId)
    .maybeSingle();

  if (existingResult.error) {
    throw new Error("Unable to load statement import review group.");
  }

  if (!existingResult.data) {
    throw new Error("Statement import review group was not found.");
  }

  const existing = existingResult.data as { metadata: PersistedGroup["metadata"]; status?: string };
  const metadata = existing.metadata;
  const decidedMetadata = decision === "confirmed"
    ? confirmedGroupMetadata(metadata)
    : { ...metadata, status: "ignored" as const };
  const nextMetadata = {
    ...decidedMetadata,
    audit: [
      ...(metadata.audit ?? []),
      { at: new Date().toISOString(), decision, userId },
    ],
  };
  const updateResult = await supabase
    .from("statement_reconciliation_groups")
    .update({ metadata: nextMetadata, status })
    .eq("user_id", userId)
    .eq("import_id", importId)
    .eq("id", groupId);

  if (updateResult.error) {
    throw new Error("Unable to save statement import review decision.");
  }

  const auditResult = await supabase
    .from("statement_import_review_audit")
    .insert({
      decision,
      group_id: groupId,
      import_id: importId,
      metadata: {
        groupKey: metadata.groupKey,
        sourceRowIndexes: metadata.sourceRowIndexes ?? [],
      },
      next_status: status,
      previous_status: existing.status ?? null,
      user_id: userId,
    });

  if (auditResult.error) {
    throw new Error("Unable to record statement import review audit.");
  }

  const rowIndexes = metadata.sourceRowIndexes ?? [];

  if (rowIndexes.length > 0) {
    const rowUpdate = await supabase
      .from("statement_import_rows")
      .update({ status: decision === "confirmed" ? "staged" : "rejected" })
      .eq("user_id", userId)
      .eq("import_id", importId)
      .in("row_index", rowIndexes)
      .neq("status", "duplicate");

    if (rowUpdate.error) {
      throw new Error("Unable to update statement import row decisions.");
    }
  }

  const loaded = await loadStatementImport(supabase, userId, importId);

  if (!loaded) {
    throw new Error("Unable to load statement import after review decision.");
  }

  return loaded;
}

function rowFromRecord(row: PersistedRow): StatementImportRow {
  return {
    activityDate: row.activity_date,
    amount: numericValue(row.amount),
    classification: row.classification,
    confidence: numericValue(row.confidence),
    description: row.description,
    errors: [],
    instrument: row.instrument,
    optionActivity: null,
    optionContract: null,
    price: numericValue(row.price),
    processDate: row.process_date,
    quantity: numericValue(row.quantity),
    rawRow: row.raw_row,
    rowIndex: row.row_index,
    settleDate: row.settle_date,
    status: row.status === "duplicate" ? "ignored" : row.status,
    transCode: row.trans_code,
  };
}

export async function finalizeStatementImport(
  supabase: SupabaseClient,
  userId: string,
  importId: string,
): Promise<StatementImportResponse> {
  const records = await loadImportRecords(supabase, userId, importId);

  if (!records) {
    throw new Error("Statement import was not found.");
  }

  if (records.groups.some((group) => group.status === "needs_review")) {
    throw new Error("Resolve all statement import review groups before finalizing.");
  }

  const rows = records.rows
    .filter((row) => row.status !== "duplicate" && row.status !== "rejected")
    .map(rowFromRecord);
  const groups = records.groups.map((group) => ({
    ...group.metadata,
    status: group.status === "confirmed" || group.status === "imported"
      ? "confirmed"
      : "ignored",
  } satisfies OptionReconciliationGroup));
  const result = await writeStatementImportToPaperAccount(
    supabase,
    userId,
    rows,
    groups,
    records.import.broker,
  );
  const summary = summaryDefaults({
    ...records.import.summary,
    importedRecords: result.insertedPositions + result.insertedEquityLots,
    insertedEquityLots: result.insertedEquityLots,
    insertedEvents: result.insertedEvents,
    insertedPositions: result.insertedPositions,
    rejectedGroups: records.groups.filter((group) => group.status === "rejected").length,
    skippedDuplicates: result.skippedPositions + result.skippedEquityLots +
      records.rows.filter((row) => row.status === "duplicate").length,
    stagedRows: 0,
  });

  const importUpdate = await supabase
    .from("statement_imports")
    .update({
      imported_at: new Date().toISOString(),
      status: "imported",
      summary,
    })
    .eq("user_id", userId)
    .eq("id", importId);

  if (importUpdate.error) {
    throw new Error("Unable to finalize statement import.");
  }

  const groupUpdate = await supabase
    .from("statement_reconciliation_groups")
    .update({ status: "imported" })
    .eq("user_id", userId)
    .eq("import_id", importId)
    .eq("status", "confirmed");

  if (groupUpdate.error) {
    throw new Error("Unable to mark imported review groups.");
  }

  const rowUpdate = await supabase
    .from("statement_import_rows")
    .update({ status: "imported" })
    .eq("user_id", userId)
    .eq("import_id", importId)
    .in("status", ["staged", "needs_review"]);

  if (rowUpdate.error) {
    throw new Error("Unable to mark imported statement rows.");
  }

  const loaded = await loadStatementImport(supabase, userId, importId);

  if (!loaded) {
    throw new Error("Unable to load finalized statement import.");
  }

  return {
    ...loaded,
    status: "imported",
    summary,
  };
}
