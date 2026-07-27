import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

function fail(message) {
  throw new Error(`Account lifecycle verifier: ${message}`);
}

function requireSuccess(result, label) {
  if (result.error) {
    fail(`${label}: ${result.error.code ?? "unknown"} ${result.error.message}`);
  }

  return result.data;
}

function requireDenied(result, label) {
  if (!result.error || result.error.code !== "42501") {
    fail(
      `${label}: expected 42501, received ${
        result.error?.code ?? "successful request"
      }`,
    );
  }
}

function parseStatusEnvironment() {
  const output = execFileSync(
    "npx",
    ["supabase", "status", "--output", "env"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_TELEMETRY_DISABLED: "1",
      },
    },
  );

  return Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z_]+)=(?:"(.*)"|(.*))$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2] ?? match[3] ?? ""]),
  );
}

function client(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function createUser(service, runId, label) {
  const email = `ad014-${runId}-${label}@example.test`;
  const password = `AD014-${label}-${runId.slice(0, 8)}!Aa9`;
  const created = requireSuccess(
    await service.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
    }),
    `create ${label} Auth user`,
  );

  if (!created.user?.id) {
    fail(`create ${label} Auth user returned no id`);
  }

  requireSuccess(
    await service.from("account_profiles").insert({
      display_name: `Lifecycle ${label}`,
      email,
      first_name: "Lifecycle",
      id: created.user.id,
      last_name: label,
      primary_provider: "email",
    }),
    `create ${label} profile`,
  );

  return {
    email,
    password,
    userId: created.user.id,
  };
}

async function seedOwnedGraph(service, account, runId, label) {
  const ids = {
    analysisRequest: randomUUID(),
    equityLot: randomUUID(),
    identity: randomUUID(),
    paperAccount: randomUUID(),
    position: randomUUID(),
    positionEvent: randomUUID(),
    positionLeg: randomUUID(),
    preset: randomUUID(),
    reconciliationGroup: randomUUID(),
    reviewAudit: randomUUID(),
    statementImport: randomUUID(),
    statementImportRow: randomUUID(),
  };

  requireSuccess(
    await service.from("account_identities").insert({
      id: ids.identity,
      provider: "email",
      provider_email: account.email,
      provider_user_id: `${runId}-${label}`,
      user_id: account.userId,
    }),
    `seed ${label} account identity`,
  );
  requireSuccess(
    await service.from("saved_presets").insert({
      base_persona_id: "conservative",
      filters: { owner: label },
      id: ids.preset,
      name: `${label} lifecycle preset`,
      scoring_overrides: {},
      user_id: account.userId,
    }),
    `seed ${label} preset`,
  );
  requireSuccess(
    await service.from("analysis_requests").insert({
      id: ids.analysisRequest,
      persona_id: "conservative",
      ticker: `${label.toUpperCase()}NAL`,
      user_id: account.userId,
    }),
    `seed ${label} analysis request`,
  );
  requireSuccess(
    await service.from("paper_accounts").insert({
      current_cash: 10_000,
      id: ids.paperAccount,
      starting_cash: 10_000,
      user_id: account.userId,
    }),
    `seed ${label} paper account`,
  );
  requireSuccess(
    await service.from("simulated_positions").insert({
      contracts_opened: 1,
      contracts_remaining: 1,
      id: ids.position,
      net_credit: 1.25,
      paper_account_id: ids.paperAccount,
      strategy_type: "short_put",
      symbol: `${label.toUpperCase()}POS`,
      user_id: account.userId,
    }),
    `seed ${label} simulated position`,
  );
  requireSuccess(
    await service.from("simulated_position_legs").insert({
      contract_symbol: `${label.toUpperCase()}POS260821P00100000`,
      id: ids.positionLeg,
      leg_index: 0,
      open_price: 1.25,
      option_type: "put",
      position_id: ids.position,
      quantity: 1,
      side: "short",
      strike: 100,
    }),
    `seed ${label} position leg`,
  );
  requireSuccess(
    await service.from("simulated_position_events").insert({
      event_type: "opened",
      id: ids.positionEvent,
      paper_account_id: ids.paperAccount,
      position_id: ids.position,
      price: 1.25,
      quantity: 1,
      user_id: account.userId,
    }),
    `seed ${label} position event`,
  );
  requireSuccess(
    await service.from("simulated_equity_lots").insert({
      cost_basis: 100,
      id: ids.equityLot,
      paper_account_id: ids.paperAccount,
      shares: 100,
      source_position_id: ids.position,
      symbol: `${label.toUpperCase()}EQ`,
      user_id: account.userId,
    }),
    `seed ${label} equity lot`,
  );
  requireSuccess(
    await service.from("statement_imports").insert({
      broker: "test",
      file_hash: `${runId}-${label}-full-graph`,
      file_name: `${label}-full-graph.csv`,
      id: ids.statementImport,
      status: "needs_review",
      user_id: account.userId,
    }),
    `seed ${label} statement import`,
  );
  requireSuccess(
    await service.from("statement_import_rows").insert({
      classification: "option",
      id: ids.statementImportRow,
      import_id: ids.statementImport,
      raw_row: { owner: label },
      row_hash: `${runId}-${label}-full-graph-row`,
      row_index: 0,
      status: "needs_review",
      user_id: account.userId,
    }),
    `seed ${label} statement import row`,
  );
  requireSuccess(
    await service.from("statement_reconciliation_groups").insert({
      group_type: "option_strategy",
      id: ids.reconciliationGroup,
      import_id: ids.statementImport,
      status: "needs_review",
      strategy_type: "short_put",
      symbol: `${label.toUpperCase()}POS`,
      user_id: account.userId,
    }),
    `seed ${label} reconciliation group`,
  );
  requireSuccess(
    await service.from("statement_reconciliation_group_rows").insert({
      group_id: ids.reconciliationGroup,
      role: "short_put",
      row_id: ids.statementImportRow,
    }),
    `seed ${label} reconciliation membership`,
  );
  requireSuccess(
    await service.from("statement_import_review_audit").insert({
      decision: "confirmed",
      group_id: ids.reconciliationGroup,
      id: ids.reviewAudit,
      import_id: ids.statementImport,
      next_status: "confirmed",
      previous_status: "needs_review",
      user_id: account.userId,
    }),
    `seed ${label} review audit`,
  );

  return ids;
}

async function signIn(url, anonKey, account) {
  const authenticated = client(url, anonKey);
  const signedIn = requireSuccess(
    await authenticated.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    }),
    `sign in ${account.email}`,
  );

  assert.equal(signedIn.user?.id, account.userId);
  if (!signedIn.session?.access_token) {
    fail(`sign in ${account.email} returned no access token`);
  }

  return {
    accessToken: signedIn.session.access_token,
    client: authenticated,
  };
}

function clientWithAccessToken(url, anonKey, accessToken) {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString();
}

async function countRows(database, table, filter = null) {
  let query = database.from(table).select("*", {
    count: "exact",
    head: true,
  });

  if (filter) {
    for (const [column, value] of Object.entries(filter)) {
      query = query.eq(column, value);
    }
  }

  const result = await query;
  requireSuccess(result, `count ${table}`);
  return result.count ?? 0;
}

function assertExportMatches(exported, account, graph, label) {
  const expectedIds = {
    analysisRequests: graph.analysisRequest,
    equityLots: graph.equityLot,
    identities: graph.identity,
    paperAccounts: graph.paperAccount,
    positionEvents: graph.positionEvent,
    positionLegs: graph.positionLeg,
    positions: graph.position,
    presets: graph.preset,
    reconciliationGroups: graph.reconciliationGroup,
    reviewAudit: graph.reviewAudit,
    statementImportRows: graph.statementImportRow,
    statementImports: graph.statementImport,
  };

  assert.equal(exported.profile.id, account.userId, `${label} profile owner`);
  for (const [category, expectedId] of Object.entries(expectedIds)) {
    assert.equal(exported[category].length, 1, `${label} ${category} count`);
    assert.equal(
      exported[category][0].id,
      expectedId,
      `${label} ${category} identifier`,
    );
  }

  assert.equal(
    exported.reconciliationGroupRows.length,
    1,
    `${label} reconciliation membership count`,
  );
  assert.deepEqual(
    {
      group_id: exported.reconciliationGroupRows[0].group_id,
      row_id: exported.reconciliationGroupRows[0].row_id,
    },
    {
      group_id: graph.reconciliationGroup,
      row_id: graph.statementImportRow,
    },
    `${label} reconciliation membership identifiers`,
  );
}

function ownedGraphRows(account, graph) {
  return [
    ["account_profiles", { id: account.userId }],
    ["account_identities", { id: graph.identity }],
    ["saved_presets", { id: graph.preset }],
    ["analysis_requests", { id: graph.analysisRequest }],
    ["paper_accounts", { id: graph.paperAccount }],
    ["simulated_positions", { id: graph.position }],
    ["simulated_position_legs", { id: graph.positionLeg }],
    ["simulated_position_events", { id: graph.positionEvent }],
    ["simulated_equity_lots", { id: graph.equityLot }],
    ["statement_imports", { id: graph.statementImport }],
    ["statement_import_rows", { id: graph.statementImportRow }],
    [
      "statement_reconciliation_groups",
      { id: graph.reconciliationGroup },
    ],
    [
      "statement_reconciliation_group_rows",
      { group_id: graph.reconciliationGroup },
    ],
    ["statement_import_review_audit", { id: graph.reviewAudit }],
  ];
}

async function assertOwnedGraphCount(
  database,
  account,
  graph,
  expectedCount,
  label,
) {
  for (const [table, filter] of ownedGraphRows(account, graph)) {
    assert.equal(
      await countRows(database, table, filter),
      expectedCount,
      `${label} ${table} count`,
    );
  }
}

const status = parseStatusEnvironment();
const url = status.API_URL;
const anonKey = status.ANON_KEY;
const serviceRoleKey = status.SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  fail("local Supabase status did not return API_URL, ANON_KEY, and SERVICE_ROLE_KEY");
}

const service = client(url, serviceRoleKey);
const anonymous = client(url, anonKey);
const runId = randomUUID();
const accountA = await createUser(service, runId, "a");
const accountB = await createUser(service, runId, "b");
const signedInA = await signIn(url, anonKey, accountA);
const signedInB = await signIn(url, anonKey, accountB);
const userA = signedInA.client;
const userB = signedInB.client;
const graphA = await seedOwnedGraph(service, accountA, runId, "a");
const graphB = await seedOwnedGraph(service, accountB, runId, "b");

requireDenied(
  await anonymous.rpc("export_account_data"),
  "anon account export",
);
requireDenied(
  await service.rpc("export_account_data"),
  "service-role account export",
);
requireDenied(
  await userA.from("account_deletion_requests").select("*").limit(1),
  "authenticated deletion-audit read",
);
requireDenied(
  await userA.from("account_data_retention_runs").select("*").limit(1),
  "authenticated retention-run read",
);
requireDenied(
  await userA.rpc("delete_account_application_data", {
    p_user_id: accountB.userId,
  }),
  "authenticated cross-account deletion",
);
const untrustedPrepareArgs = {
  p_confirmation_email_hash: "untrusted-email-hash",
  p_expires_at: daysAgo(-1),
  p_reauthenticated_at: daysAgo(0),
  p_token_hash: "untrusted-token-hash",
  p_user_fingerprint: "untrusted-user-hash",
  p_user_id: accountA.userId,
};
requireDenied(
  await anonymous.rpc(
    "prepare_account_deletion_request",
    untrustedPrepareArgs,
  ),
  "anonymous deletion-tombstone preparation",
);
requireDenied(
  await userA.rpc(
    "prepare_account_deletion_request",
    untrustedPrepareArgs,
  ),
  "authenticated deletion-tombstone preparation",
);

const exportA = requireSuccess(
  await userA.rpc("export_account_data"),
  "User A export",
);
const exportB = requireSuccess(
  await userB.rpc("export_account_data"),
  "User B export",
);
const expectedExportKeys = [
  "analysisRequests",
  "equityLots",
  "identities",
  "paperAccounts",
  "positionEvents",
  "positionLegs",
  "positions",
  "presets",
  "profile",
  "reconciliationGroupRows",
  "reconciliationGroups",
  "reviewAudit",
  "statementImportRows",
  "statementImports",
].sort();

assert.deepEqual(Object.keys(exportA).sort(), expectedExportKeys);
assert.deepEqual(Object.keys(exportB).sort(), expectedExportKeys);
assertExportMatches(exportA, accountA, graphA, "User A export");
assertExportMatches(exportB, accountB, graphB, "User B export");
await assertOwnedGraphCount(service, accountA, graphA, 1, "User A seeded");
await assertOwnedGraphCount(service, accountB, graphB, 1, "User B seeded");

const deletionRequestA = requireSuccess(
  await service.rpc("prepare_account_deletion_request", {
    p_confirmation_email_hash: `email-${runId}`,
    p_expires_at: daysAgo(-1),
    p_reauthenticated_at: daysAgo(0),
    p_token_hash: `token-${runId}-a`,
    p_user_fingerprint: `user-${runId}`,
    p_user_id: accountA.userId,
  }),
  "create User A deletion tombstone",
);
const rotatedDeletionRequestA = requireSuccess(
  await service.rpc("prepare_account_deletion_request", {
    p_confirmation_email_hash: `email-${runId}`,
    p_expires_at: daysAgo(-1),
    p_reauthenticated_at: daysAgo(0),
    p_token_hash: `token-${runId}-b`,
    p_user_fingerprint: `user-${runId}`,
    p_user_id: accountA.userId,
  }),
  "rotate User A deletion retry authorization",
);
assert.equal(
  rotatedDeletionRequestA.id,
  deletionRequestA.id,
  "reauthorization rotates one durable tombstone instead of creating another",
);
requireDenied(
  await userA
    .from("account_profiles")
    .update({ display_name: "Blocked by tombstone" })
    .eq("id", accountA.userId),
  "tombstoned profile update before session revocation",
);
requireDenied(
  await userA.from("saved_presets").insert({
    base_persona_id: "balanced",
    name: "blocked-by-tombstone",
    user_id: accountA.userId,
  }),
  "tombstoned dependent write before session revocation",
);

requireSuccess(
  await service.auth.admin.signOut(signedInA.accessToken, "global"),
  "globally revoke User A refresh sessions",
);
const revokedRefresh = await userA.auth.refreshSession();
assert.ok(
  revokedRefresh.error,
  "User A refresh token is invalid after global revocation",
);
const revokedAccessUserA = clientWithAccessToken(
  url,
  anonKey,
  signedInA.accessToken,
);

const deletedA = requireSuccess(
  await service.rpc("delete_account_application_data", {
    p_user_id: accountA.userId,
  }),
  "delete User A application data",
);
assert.equal(deletedA.profilesDeleted, 1);
assert.equal(deletedA.identitiesDeleted, 1);
await assertOwnedGraphCount(service, accountA, graphA, 0, "User A deleted");
await assertOwnedGraphCount(service, accountB, graphB, 1, "User B retained");

const staleProfileRecreation = await revokedAccessUserA
  .from("account_profiles")
  .insert({
    email: accountA.email,
    first_name: "Stale",
    id: accountA.userId,
    last_name: "Session",
    primary_provider: "email",
  });
requireDenied(
  staleProfileRecreation,
  "revoked access JWT profile recreation under a deletion tombstone",
);
const staleIdentityRecreation = await revokedAccessUserA
  .from("account_identities")
  .insert({
    provider: "email",
    provider_user_id: `stale-${runId}`,
    user_id: accountA.userId,
  });
requireDenied(
  staleIdentityRecreation,
  "revoked access JWT identity recreation under a deletion tombstone",
);
assert.ok(
  (
    await revokedAccessUserA.from("saved_presets").insert({
      base_persona_id: "balanced",
      name: "stale",
      user_id: accountA.userId,
    })
  ).error,
  "revoked access JWT cannot recreate a profile-dependent account root",
);

const repeatedDeleteA = requireSuccess(
  await service.rpc("delete_account_application_data", {
    p_user_id: accountA.userId,
  }),
  "repeat User A application-data deletion",
);
assert.deepEqual(repeatedDeleteA, {
  identitiesDeleted: 0,
  profilesDeleted: 0,
});

const emptyExportA = requireSuccess(
  await revokedAccessUserA.rpc("export_account_data"),
  "User A post-deletion export with the revoked access JWT",
);
assert.equal(emptyExportA.profile, null);
for (const [category, records] of Object.entries(emptyExportA)) {
  if (category !== "profile") {
    assert.deepEqual(records, [], `post-deletion ${category} is empty`);
  }
}

requireSuccess(
  await service.auth.admin.getUserById(accountA.userId),
  "User A Auth row remains before hard deletion",
);
requireSuccess(
  await service.auth.admin.deleteUser(accountA.userId, false),
  "hard-delete User A Auth row",
);
const missingAuthA = await service.auth.admin.getUserById(accountA.userId);
assert.ok(missingAuthA.error, "User A Auth row is gone after hard deletion");
const repeatedAuthDeleteA = await service.auth.admin.deleteUser(
  accountA.userId,
  false,
);
if (repeatedAuthDeleteA.error) {
  assert.equal(
    repeatedAuthDeleteA.error.code,
    "user_not_found",
    "repeat Auth deletion fails only because the user is already absent",
  );
}
requireSuccess(
  await service
    .from("account_deletion_requests")
    .update({
      auth_user_deleted_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: "completed",
      token_hash: null,
      user_id: null,
    })
    .eq("id", deletionRequestA.id),
  "complete User A deletion audit",
);

const oldAnalysisId = randomUUID();
const recentAnalysisId = randomUUID();
requireSuccess(
  await service.from("analysis_requests").insert([
    {
      id: oldAnalysisId,
      persona_id: "conservative",
      requested_at: daysAgo(91),
      ticker: "OLD",
      user_id: accountB.userId,
    },
    {
      id: recentAnalysisId,
      persona_id: "conservative",
      requested_at: daysAgo(89),
      ticker: "NEW",
      user_id: accountB.userId,
    },
  ]),
  "seed analysis retention boundaries",
);

const incompleteOldId = randomUUID();
const incompleteRecentId = randomUUID();
const importedRawExpiredId = randomUUID();
const importedMetadataExpiredId = randomUUID();
requireSuccess(
  await service.from("statement_imports").insert([
    {
      broker: "test",
      created_at: daysAgo(32),
      file_hash: `${runId}-incomplete-old`,
      file_name: "incomplete-old.csv",
      id: incompleteOldId,
      status: "failed",
      updated_at: daysAgo(31),
      user_id: accountB.userId,
    },
    {
      broker: "test",
      created_at: daysAgo(30),
      file_hash: `${runId}-incomplete-recent`,
      file_name: "incomplete-recent.csv",
      id: incompleteRecentId,
      status: "failed",
      updated_at: daysAgo(29),
      user_id: accountB.userId,
    },
    {
      broker: "test",
      created_at: daysAgo(92),
      file_hash: `${runId}-raw-expired`,
      file_name: "raw-expired.csv",
      id: importedRawExpiredId,
      imported_at: daysAgo(91),
      status: "imported",
      updated_at: daysAgo(91),
      user_id: accountB.userId,
    },
    {
      broker: "test",
      created_at: daysAgo(367),
      file_hash: `${runId}-metadata-expired`,
      file_name: "metadata-expired.csv",
      id: importedMetadataExpiredId,
      imported_at: daysAgo(366),
      status: "imported",
      updated_at: daysAgo(366),
      user_id: accountB.userId,
    },
  ]),
  "seed statement-import retention boundaries",
);

const rawExpiredRowId = randomUUID();
const metadataExpiredRowId = randomUUID();
requireSuccess(
  await service.from("statement_import_rows").insert([
    {
      classification: "cash",
      id: rawExpiredRowId,
      import_id: importedRawExpiredId,
      raw_row: { retention: "raw" },
      row_hash: `${runId}-raw-row`,
      row_index: 0,
      status: "imported",
      user_id: accountB.userId,
    },
    {
      classification: "cash",
      id: metadataExpiredRowId,
      import_id: importedMetadataExpiredId,
      raw_row: { retention: "metadata" },
      row_hash: `${runId}-metadata-row`,
      row_index: 0,
      status: "imported",
      user_id: accountB.userId,
    },
  ]),
  "seed raw-row retention boundaries",
);

const rawExpiredGroupId = randomUUID();
const metadataExpiredGroupId = randomUUID();
const rawExpiredAuditId = randomUUID();
const metadataExpiredAuditId = randomUUID();
requireSuccess(
  await service.from("statement_reconciliation_groups").insert([
    {
      group_type: "cash_activity",
      id: rawExpiredGroupId,
      import_id: importedRawExpiredId,
      status: "imported",
      user_id: accountB.userId,
    },
    {
      group_type: "cash_activity",
      id: metadataExpiredGroupId,
      import_id: importedMetadataExpiredId,
      status: "imported",
      user_id: accountB.userId,
    },
  ]),
  "seed reconciliation-metadata retention boundaries",
);
requireSuccess(
  await service.from("statement_reconciliation_group_rows").insert([
    {
      group_id: rawExpiredGroupId,
      role: "source",
      row_id: rawExpiredRowId,
    },
    {
      group_id: metadataExpiredGroupId,
      role: "source",
      row_id: metadataExpiredRowId,
    },
  ]),
  "seed reconciliation-membership retention boundaries",
);
requireSuccess(
  await service.from("statement_import_review_audit").insert([
    {
      decision: "confirmed",
      group_id: rawExpiredGroupId,
      id: rawExpiredAuditId,
      import_id: importedRawExpiredId,
      next_status: "imported",
      previous_status: "needs_review",
      user_id: accountB.userId,
    },
    {
      decision: "confirmed",
      group_id: metadataExpiredGroupId,
      id: metadataExpiredAuditId,
      import_id: importedMetadataExpiredId,
      next_status: "imported",
      previous_status: "needs_review",
      user_id: accountB.userId,
    },
  ]),
  "seed review-audit retention boundaries",
);

const oldDeletionRequestId = randomUUID();
const recentDeletionRequestId = randomUUID();
const staleActiveDeletionRequestId = randomUUID();
requireSuccess(
  await service.from("account_deletion_requests").insert([
    {
      completed_at: daysAgo(100),
      confirmation_email_hash: "old-email-hash",
      expires_at: daysAgo(100),
      id: oldDeletionRequestId,
      reauthenticated_at: daysAgo(101),
      status: "completed",
      token_hash: null,
      user_fingerprint: "old-user-hash",
      user_id: null,
    },
    {
      confirmation_email_hash: "recent-email-hash",
      expires_at: daysAgo(-1),
      id: recentDeletionRequestId,
      reauthenticated_at: daysAgo(1),
      status: "authorized",
      token_hash: `recent-token-${runId}`,
      user_fingerprint: "recent-user-hash",
      user_id: accountB.userId,
    },
    {
      confirmation_email_hash: "stale-active-email-hash",
      expires_at: daysAgo(100),
      id: staleActiveDeletionRequestId,
      reauthenticated_at: daysAgo(101),
      status: "failed",
      token_hash: `stale-active-token-${runId}`,
      user_fingerprint: "stale-active-user-hash",
      user_id: randomUUID(),
    },
  ]),
  "seed deletion-audit retention boundaries",
);

const oldRetentionRunId = randomUUID();
requireSuccess(
  await service.from("account_data_retention_runs").insert({
    completed_at: daysAgo(100),
    id: oldRetentionRunId,
    started_at: daysAgo(100),
    status: "completed",
  }),
  "seed old retention-run history",
);

const retention = requireSuccess(
  await service.rpc("run_account_data_retention"),
  "run account-data retention",
);
assert.equal(retention.status, "completed");
assert.deepEqual(retention.deletedCounts, {
  analysisRequests: 1,
  completedImports: 1,
  deletionRequests: 1,
  incompleteImports: 1,
  rawImportRowsRedacted: 2,
  retentionRuns: 1,
});
assert.equal(
  await countRows(service, "analysis_requests", { id: oldAnalysisId }),
  0,
);
assert.equal(
  await countRows(service, "analysis_requests", { id: recentAnalysisId }),
  1,
);
assert.equal(
  await countRows(service, "statement_imports", { id: incompleteOldId }),
  0,
);
assert.equal(
  await countRows(service, "statement_imports", { id: incompleteRecentId }),
  1,
);
assert.equal(
  await countRows(service, "statement_imports", {
    id: importedRawExpiredId,
  }),
  1,
);
assert.equal(
  await countRows(service, "statement_import_rows", { id: rawExpiredRowId }),
  1,
);
const redactedRawRow = requireSuccess(
  await service
    .from("statement_import_rows")
    .select(
      "row_hash, raw_row, activity_date, process_date, settle_date, instrument, description, trans_code, quantity, price, amount, confidence, classification, status",
    )
    .eq("id", rawExpiredRowId)
    .single(),
  "read redacted 91-day import row",
);
assert.deepEqual(redactedRawRow, {
  activity_date: null,
  amount: null,
  classification: "cash",
  confidence: null,
  description: null,
  instrument: null,
  price: null,
  process_date: null,
  quantity: null,
  raw_row: {},
  row_hash: `retained:${rawExpiredRowId}`,
  settle_date: null,
  status: "imported",
  trans_code: null,
});
assert.equal(
  await countRows(service, "statement_reconciliation_groups", {
    id: rawExpiredGroupId,
  }),
  1,
);
assert.equal(
  await countRows(service, "statement_reconciliation_group_rows", {
    group_id: rawExpiredGroupId,
    row_id: rawExpiredRowId,
  }),
  1,
);
assert.equal(
  await countRows(service, "statement_import_review_audit", {
    id: rawExpiredAuditId,
  }),
  1,
);
assert.equal(
  await countRows(service, "statement_imports", {
    id: importedMetadataExpiredId,
  }),
  0,
);
assert.equal(
  await countRows(service, "statement_import_rows", {
    id: metadataExpiredRowId,
  }),
  0,
);
assert.equal(
  await countRows(service, "statement_reconciliation_groups", {
    id: metadataExpiredGroupId,
  }),
  0,
);
assert.equal(
  await countRows(service, "statement_reconciliation_group_rows", {
    group_id: metadataExpiredGroupId,
  }),
  0,
);
assert.equal(
  await countRows(service, "statement_import_review_audit", {
    id: metadataExpiredAuditId,
  }),
  0,
);
assert.equal(
  await countRows(service, "account_deletion_requests", {
    id: oldDeletionRequestId,
  }),
  0,
);
assert.equal(
  await countRows(service, "account_deletion_requests", {
    id: recentDeletionRequestId,
  }),
  1,
);
assert.equal(
  await countRows(service, "account_deletion_requests", {
    id: staleActiveDeletionRequestId,
  }),
  1,
);

const retentionRun = requireSuccess(
  await service
    .from("account_data_retention_runs")
    .select("status, deleted_counts, error_code")
    .eq("id", retention.runId)
    .single(),
  "read observable retention run",
);
assert.equal(retentionRun.status, "completed");
assert.equal(retentionRun.error_code, null);
assert.deepEqual(retentionRun.deleted_counts, retention.deletedCounts);

requireSuccess(
  await service.rpc("delete_account_application_data", {
    p_user_id: accountB.userId,
  }),
  "clean up User B application data",
);
requireSuccess(
  await service.auth.admin.deleteUser(accountB.userId, false),
  "clean up User B Auth row",
);

process.stdout.write(
  "AD-014 account lifecycle passed fully populated two-user export/count " +
    "isolation, least-privilege RPCs, durable tombstone rotation, pre- and " +
    "post-revocation stale-JWT write denial, complete cascade deletion, Auth " +
    "hard deletion, 90/365-day relational retention, and observable cleanup.\n",
);
