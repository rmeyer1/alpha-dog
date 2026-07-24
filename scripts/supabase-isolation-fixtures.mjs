import { randomUUID } from "node:crypto";

export const ACCOUNT_TABLES = [
  "account_profiles",
  "account_identities",
  "saved_presets",
  "analysis_requests",
  "paper_accounts",
  "simulated_positions",
  "simulated_position_legs",
  "simulated_position_events",
  "simulated_equity_lots",
  "statement_imports",
  "statement_import_rows",
  "statement_reconciliation_groups",
  "statement_reconciliation_group_rows",
  "statement_import_review_audit",
];

export const DELETE_ORDER = [
  "statement_import_review_audit",
  "statement_reconciliation_group_rows",
  "statement_reconciliation_groups",
  "statement_import_rows",
  "statement_imports",
  "simulated_position_legs",
  "simulated_position_events",
  "simulated_equity_lots",
  "simulated_positions",
  "paper_accounts",
  "analysis_requests",
  "saved_presets",
  "account_identities",
  "account_profiles",
];

const MUTABLE_PATCHES = {
  account_profiles: (marker) => ({ first_name: `Updated-${marker}` }),
  account_identities: (marker) => ({
    provider_email: `updated-${marker}@example.test`,
  }),
  saved_presets: (marker) => ({ name: `Updated preset ${marker}` }),
  analysis_requests: () => ({ ticker: "MSFT" }),
  paper_accounts: (marker) => ({ current_cash: 10_000 + marker.length }),
  simulated_positions: (marker) => ({ notes: `updated-${marker}` }),
  simulated_position_legs: (marker) => ({
    snapshot: { updatedBy: marker },
  }),
  simulated_position_events: (marker) => ({
    metadata: { updatedBy: marker },
  }),
  simulated_equity_lots: (marker) => ({
    cost_basis: 20 + marker.length,
  }),
  statement_imports: (marker) => ({ summary: { updatedBy: marker } }),
  statement_import_rows: (marker) => ({ raw_row: { updatedBy: marker } }),
  statement_reconciliation_groups: (marker) => ({
    metadata: { updatedBy: marker },
  }),
  statement_reconciliation_group_rows: (marker) => ({
    role: `updated-${marker}`,
  }),
  statement_import_review_audit: (marker) => ({
    metadata: { updatedBy: marker },
  }),
};

export function mutablePatch(table, marker) {
  return MUTABLE_PATCHES[table](marker);
}

export function rowFilter(table, row) {
  if (table === "statement_reconciliation_group_rows") {
    return {
      group_id: row.group_id,
      row_id: row.row_id,
    };
  }

  return { id: row.id };
}

export function applyFilter(query, filter) {
  return Object.entries(filter).reduce(
    (filtered, [column, value]) => filtered.eq(column, value),
    query,
  );
}

function requireData(result, label) {
  if (result.error) {
    throw new Error(
      `${label}: ${result.error.code ?? "unknown"} ${result.error.message}`,
    );
  }

  if (!result.data) {
    throw new Error(`${label}: no row returned`);
  }

  return result.data;
}

async function insertOne(client, table, payload, label) {
  const result = await client.from(table).insert(payload).select("*").single();
  return requireData(result, `${label} insert ${table}`);
}

export async function insertOwnerGraph(client, owner, label) {
  const suffix = `${label.toLowerCase()}-${randomUUID()}`;
  const rows = {};
  const payloads = {};

  payloads.account_profiles = {
    id: owner.userId,
    email: owner.email,
    first_name: `First-${label}`,
    last_name: `Last-${label}`,
    display_name: `Owner ${label}`,
    primary_provider: "email",
  };
  rows.account_profiles = await insertOne(
    client,
    "account_profiles",
    payloads.account_profiles,
    label,
  );

  payloads.account_identities = {
    id: randomUUID(),
    user_id: owner.userId,
    provider: `test-${suffix}`,
    provider_user_id: `provider-${suffix}`,
    provider_email: owner.email,
  };
  rows.account_identities = await insertOne(
    client,
    "account_identities",
    payloads.account_identities,
    label,
  );

  payloads.saved_presets = {
    id: randomUUID(),
    user_id: owner.userId,
    name: `Preset ${label}`,
    base_persona_id: "conservative",
    filters: { label },
    scoring_overrides: { label },
  };
  rows.saved_presets = await insertOne(
    client,
    "saved_presets",
    payloads.saved_presets,
    label,
  );

  payloads.analysis_requests = {
    id: randomUUID(),
    user_id: owner.userId,
    ticker: "AAPL",
    persona_id: "conservative",
    filters: { label },
    feed: "test",
    cache_status: "miss",
  };
  rows.analysis_requests = await insertOne(
    client,
    "analysis_requests",
    payloads.analysis_requests,
    label,
  );

  payloads.paper_accounts = {
    id: randomUUID(),
    user_id: owner.userId,
    starting_cash: 25_000,
    current_cash: 25_000,
    margin_balance: 0,
    margin_interest_rate: 0.05,
  };
  rows.paper_accounts = await insertOne(
    client,
    "paper_accounts",
    payloads.paper_accounts,
    label,
  );

  payloads.simulated_positions = {
    id: randomUUID(),
    user_id: owner.userId,
    paper_account_id: rows.paper_accounts.id,
    source: "simulated",
    status: "open",
    strategy_type: "short_put",
    symbol: `T${label}`.slice(0, 8).toUpperCase(),
    opened_at: "2026-07-01T14:30:00.000Z",
    contracts_opened: 1,
    contracts_remaining: 1,
    net_credit: 1.25,
    notes: `fixture-${label}`,
    underlying_price_at_open: 25,
    expiration_date: "2026-08-21",
    data_source_mode: "demo",
    candidate_feed: "demo",
    candidate_cache_status: "demo",
    candidate_cache_source: "demo",
    candidate_as_of: "2026-07-01T14:29:00.000Z",
  };
  rows.simulated_positions = await insertOne(
    client,
    "simulated_positions",
    payloads.simulated_positions,
    label,
  );

  payloads.simulated_position_legs = {
    id: randomUUID(),
    position_id: rows.simulated_positions.id,
    leg_index: 0,
    side: "short",
    option_type: "put",
    contract_symbol: `T${label}260821P00025000`.toUpperCase(),
    strike: 25,
    expiration_date: "2026-08-21",
    quantity: 1,
    open_price: 1.25,
    current_mark: 1.1,
    snapshot: { label },
  };
  rows.simulated_position_legs = await insertOne(
    client,
    "simulated_position_legs",
    payloads.simulated_position_legs,
    label,
  );

  payloads.simulated_position_events = {
    id: randomUUID(),
    user_id: owner.userId,
    paper_account_id: rows.paper_accounts.id,
    position_id: rows.simulated_positions.id,
    event_type: "opened",
    quantity: 1,
    price: 1.25,
    cash_delta: 125,
    realized_pnl_delta: 0,
    margin_delta: 0,
    metadata: { label },
  };
  rows.simulated_position_events = await insertOne(
    client,
    "simulated_position_events",
    payloads.simulated_position_events,
    label,
  );

  payloads.simulated_equity_lots = {
    id: randomUUID(),
    user_id: owner.userId,
    paper_account_id: rows.paper_accounts.id,
    symbol: `L${label}`.slice(0, 8).toUpperCase(),
    shares: 100,
    cost_basis: 15,
    source_position_id: rows.simulated_positions.id,
    acquired_at: "2026-07-01T14:30:00.000Z",
    source_fingerprint: `lot-${suffix}`,
  };
  rows.simulated_equity_lots = await insertOne(
    client,
    "simulated_equity_lots",
    payloads.simulated_equity_lots,
    label,
  );

  payloads.statement_imports = {
    id: randomUUID(),
    user_id: owner.userId,
    broker: "robinhood",
    file_name: `${suffix}.csv`,
    file_hash: `file-${suffix}`,
    status: "uploaded",
    summary: { label },
  };
  rows.statement_imports = await insertOne(
    client,
    "statement_imports",
    payloads.statement_imports,
    label,
  );

  payloads.statement_import_rows = {
    id: randomUUID(),
    import_id: rows.statement_imports.id,
    user_id: owner.userId,
    row_index: 0,
    row_hash: `row-${suffix}`,
    raw_row: { label },
    activity_date: "2026-07-01",
    description: `fixture-${label}`,
    classification: "cash",
    confidence: 0.99,
    status: "staged",
  };
  rows.statement_import_rows = await insertOne(
    client,
    "statement_import_rows",
    payloads.statement_import_rows,
    label,
  );

  payloads.statement_reconciliation_groups = {
    id: randomUUID(),
    import_id: rows.statement_imports.id,
    user_id: owner.userId,
    group_type: "cash_activity",
    confidence: 0.99,
    status: "staged",
    metadata: { label },
  };
  rows.statement_reconciliation_groups = await insertOne(
    client,
    "statement_reconciliation_groups",
    payloads.statement_reconciliation_groups,
    label,
  );

  payloads.statement_reconciliation_group_rows = {
    group_id: rows.statement_reconciliation_groups.id,
    row_id: rows.statement_import_rows.id,
    role: "primary",
  };
  rows.statement_reconciliation_group_rows = await insertOne(
    client,
    "statement_reconciliation_group_rows",
    payloads.statement_reconciliation_group_rows,
    label,
  );

  payloads.statement_import_review_audit = {
    id: randomUUID(),
    import_id: rows.statement_imports.id,
    group_id: rows.statement_reconciliation_groups.id,
    user_id: owner.userId,
    decision: "confirmed",
    previous_status: "needs_review",
    next_status: "confirmed",
    metadata: { label },
  };
  rows.statement_import_review_audit = await insertOne(
    client,
    "statement_import_review_audit",
    payloads.statement_import_review_audit,
    label,
  );

  return { owner, payloads, rows };
}

export function crossInsertPayload(
  table,
  attackerGraph,
  targetGraph,
  spareUsers,
  marker,
) {
  const suffix = `${marker.toLowerCase()}-${randomUUID()}`;
  const attacker = attackerGraph.owner;
  const target = targetGraph.owner;

  const payloads = {
    account_profiles: {
      id: spareUsers.unprofiledUserId,
      email: `unprofiled-${suffix}@example.test`,
      first_name: "Cross",
      last_name: "Profile",
    },
    account_identities: {
      id: randomUUID(),
      user_id: target.userId,
      provider: `cross-${suffix}`,
      provider_user_id: `cross-${suffix}`,
    },
    saved_presets: {
      id: randomUUID(),
      user_id: target.userId,
      name: `Cross preset ${marker}`,
      base_persona_id: "conservative",
      filters: {},
    },
    analysis_requests: {
      id: randomUUID(),
      user_id: target.userId,
      ticker: "NVDA",
      persona_id: "conservative",
      filters: {},
    },
    paper_accounts: {
      id: randomUUID(),
      user_id: spareUsers.profiledUserId,
      starting_cash: 1_000,
      current_cash: 1_000,
    },
    simulated_positions: {
      id: randomUUID(),
      user_id: target.userId,
      paper_account_id: targetGraph.rows.paper_accounts.id,
      source: "simulated",
      status: "open",
      strategy_type: "short_put",
      symbol: "CROSS",
      opened_at: "2026-07-01T14:30:00.000Z",
      contracts_opened: 1,
      contracts_remaining: 1,
      net_credit: 1,
      data_source_mode: "demo",
    },
    simulated_position_legs: {
      id: randomUUID(),
      position_id: targetGraph.rows.simulated_positions.id,
      leg_index: 99,
      side: "short",
      option_type: "put",
      quantity: 1,
      open_price: 1,
      snapshot: {},
    },
    simulated_position_events: {
      id: randomUUID(),
      user_id: attacker.userId,
      paper_account_id: targetGraph.rows.paper_accounts.id,
      position_id: targetGraph.rows.simulated_positions.id,
      event_type: "opened",
      quantity: 1,
      price: 1,
      cash_delta: 100,
      realized_pnl_delta: 0,
      margin_delta: 0,
      metadata: { marker },
    },
    simulated_equity_lots: {
      id: randomUUID(),
      user_id: attacker.userId,
      paper_account_id: targetGraph.rows.paper_accounts.id,
      symbol: "CROSS",
      shares: 100,
      cost_basis: 10,
      source_position_id: targetGraph.rows.simulated_positions.id,
      acquired_at: "2026-07-01T14:30:00.000Z",
      source_fingerprint: `cross-${suffix}`,
    },
    statement_imports: {
      id: randomUUID(),
      user_id: target.userId,
      broker: "robinhood",
      file_name: `${suffix}.csv`,
      file_hash: `cross-${suffix}`,
      status: "uploaded",
      summary: {},
    },
    statement_import_rows: {
      id: randomUUID(),
      import_id: targetGraph.rows.statement_imports.id,
      user_id: attacker.userId,
      row_index: 99,
      row_hash: `cross-${suffix}`,
      raw_row: {},
      classification: "cash",
      status: "staged",
    },
    statement_reconciliation_groups: {
      id: randomUUID(),
      import_id: targetGraph.rows.statement_imports.id,
      user_id: attacker.userId,
      group_type: "cash_activity",
      status: "staged",
      metadata: {},
    },
    statement_reconciliation_group_rows: {
      group_id: attackerGraph.rows.statement_reconciliation_groups.id,
      row_id: targetGraph.rows.statement_import_rows.id,
      role: `cross-${marker}`,
    },
    statement_import_review_audit: {
      id: randomUUID(),
      import_id: targetGraph.rows.statement_imports.id,
      group_id: targetGraph.rows.statement_reconciliation_groups.id,
      user_id: attacker.userId,
      decision: "confirmed",
      previous_status: "needs_review",
      next_status: "confirmed",
      metadata: { marker },
    },
  };

  return payloads[table];
}

export function ownerSpoofPatch(table, targetGraph, spareUsers) {
  const patches = {
    account_profiles: { id: spareUsers.unprofiledUserId },
    account_identities: { user_id: targetGraph.owner.userId },
    saved_presets: { user_id: targetGraph.owner.userId },
    analysis_requests: { user_id: targetGraph.owner.userId },
    paper_accounts: { user_id: spareUsers.profiledUserId },
    simulated_positions: {
      user_id: targetGraph.owner.userId,
      paper_account_id: targetGraph.rows.paper_accounts.id,
    },
    simulated_position_legs: {
      position_id: targetGraph.rows.simulated_positions.id,
    },
    simulated_position_events: {
      user_id: targetGraph.owner.userId,
      paper_account_id: targetGraph.rows.paper_accounts.id,
      position_id: targetGraph.rows.simulated_positions.id,
    },
    simulated_equity_lots: {
      user_id: targetGraph.owner.userId,
      paper_account_id: targetGraph.rows.paper_accounts.id,
      source_position_id: targetGraph.rows.simulated_positions.id,
    },
    statement_imports: { user_id: targetGraph.owner.userId },
    statement_import_rows: {
      user_id: targetGraph.owner.userId,
      import_id: targetGraph.rows.statement_imports.id,
    },
    statement_reconciliation_groups: {
      user_id: targetGraph.owner.userId,
      import_id: targetGraph.rows.statement_imports.id,
    },
    statement_reconciliation_group_rows: {
      group_id: targetGraph.rows.statement_reconciliation_groups.id,
      row_id: targetGraph.rows.statement_import_rows.id,
    },
    statement_import_review_audit: {
      user_id: targetGraph.owner.userId,
      import_id: targetGraph.rows.statement_imports.id,
      group_id: targetGraph.rows.statement_reconciliation_groups.id,
    },
  };

  return patches[table];
}
