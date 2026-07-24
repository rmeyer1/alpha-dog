import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { summarizePaperAccount } from "../src/lib/account/simulated-accounting.ts";

import {
  ACCOUNT_TABLES,
  DELETE_ORDER,
  applyFilter,
  crossInsertPayload,
  insertOwnerGraph,
  mutablePatch,
  ownerSpoofPatch,
  rowFilter,
} from "./supabase-isolation-fixtures.mjs";

const AUDIT_TABLE = "statement_import_review_audit";

function fail(message) {
  throw new Error(`Data API verifier: ${message}`);
}

function requireSuccess(result, label) {
  if (result.error) {
    fail(`${label}: ${result.error.code ?? "unknown"} ${result.error.message}`);
  }
  return result.data;
}

function requireRows(result, expected, label) {
  const data = requireSuccess(result, label);
  if (!Array.isArray(data) || data.length !== expected) {
    fail(`${label}: expected ${expected} row(s), received ${data?.length ?? 0}`);
  }
  return data;
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

function publicClient(url, anonKey) {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function authenticatedClient(url, anonKey, credentials) {
  const client = publicClient(url, anonKey);
  const result = await client.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });
  const data = requireSuccess(result, `sign in ${credentials.email}`);

  assert.equal(
    data.user?.id,
    credentials.userId,
    `signed-in identity for ${credentials.email}`,
  );
  return client;
}

async function selectRows(client, table, filter) {
  return applyFilter(client.from(table).select("*"), filter);
}

async function selectOne(client, table, row, label) {
  const result = await selectRows(client, table, rowFilter(table, row));
  return requireRows(result, 1, label)[0];
}

async function countRows(client, table) {
  const result = await client
    .from(table)
    .select("*", { count: "exact", head: true });
  requireSuccess(result, `count ${table}`);
  return result.count ?? 0;
}

async function verifyAnonymousMatrix(
  anonymousClient,
  graphA,
  graphB,
  spareUsers,
) {
  for (const table of ACCOUNT_TABLES) {
    requireDenied(
      await anonymousClient.from(table).select("*").limit(1),
      `anon SELECT ${table}`,
    );
    requireDenied(
      await anonymousClient
        .from(table)
        .insert(
          crossInsertPayload(
            table,
            graphA,
            graphB,
            spareUsers,
            `anon-${table}`,
          ),
        ),
      `anon INSERT ${table}`,
    );
    requireDenied(
      await applyFilter(
        anonymousClient.from(table).update(mutablePatch(table, "anon")),
        rowFilter(table, graphA.rows[table]),
      ),
      `anon UPDATE ${table}`,
    );
    requireDenied(
      await applyFilter(
        anonymousClient.from(table).delete(),
        rowFilter(table, graphA.rows[table]),
      ),
      `anon DELETE ${table}`,
    );
  }
}

async function verifyAuthenticatedSelectAndInsertMatrix(
  clientA,
  clientB,
  graphA,
  graphB,
  spareUsers,
) {
  for (const table of ACCOUNT_TABLES) {
    requireRows(
      await selectRows(clientA, table, rowFilter(table, graphA.rows[table])),
      1,
      `User A SELECT own ${table}`,
    );
    requireRows(
      await selectRows(clientA, table, rowFilter(table, graphB.rows[table])),
      0,
      `User A SELECT User B ${table}`,
    );
    requireRows(
      await selectRows(clientB, table, rowFilter(table, graphB.rows[table])),
      1,
      `User B SELECT own ${table}`,
    );
    requireRows(
      await selectRows(clientB, table, rowFilter(table, graphA.rows[table])),
      0,
      `User B SELECT User A ${table}`,
    );

    requireDenied(
      await clientA
        .from(table)
        .insert(
          crossInsertPayload(
            table,
            graphA,
            graphB,
            spareUsers,
            `a-to-b-${table}`,
          ),
        ),
      `User A cross-owner INSERT ${table}`,
    );
    requireDenied(
      await clientB
        .from(table)
        .insert(
          crossInsertPayload(
            table,
            graphB,
            graphA,
            spareUsers,
            `b-to-a-${table}`,
          ),
        ),
      `User B cross-owner INSERT ${table}`,
    );
  }
}

async function verifySameOwnerAuditMismatch(clientA, graphA) {
  const extraImport = requireRows(
    await clientA
      .from("statement_imports")
      .insert({
        id: randomUUID(),
        user_id: graphA.owner.userId,
        broker: "robinhood",
        file_name: `mismatch-${randomUUID()}.csv`,
        file_hash: `mismatch-${randomUUID()}`,
        status: "uploaded",
        summary: {},
      })
      .select("*"),
    1,
    "User A create second import for mismatch test",
  )[0];

  requireDenied(
    await clientA.from(AUDIT_TABLE).insert({
      id: randomUUID(),
      import_id: extraImport.id,
      group_id: graphA.rows.statement_reconciliation_groups.id,
      user_id: graphA.owner.userId,
      decision: "confirmed",
      previous_status: "needs_review",
      next_status: "confirmed",
      metadata: { mismatch: true },
    }),
    "same-owner audit import/group mismatch",
  );

  requireRows(
    await clientA
      .from("statement_imports")
      .delete()
      .eq("id", extraImport.id)
      .select("*"),
    1,
    "delete mismatch-test import",
  );
}

async function verifyAuthenticatedUpdateMatrix(
  clientA,
  clientB,
  graphA,
  graphB,
  spareUsers,
) {
  for (const table of ACCOUNT_TABLES) {
    const filterA = rowFilter(table, graphA.rows[table]);
    const filterB = rowFilter(table, graphB.rows[table]);

    if (table === AUDIT_TABLE) {
      requireDenied(
        await applyFilter(
          clientA.from(table).update(mutablePatch(table, "a-own")),
          filterA,
        ),
        "User A UPDATE immutable audit",
      );
      requireDenied(
        await applyFilter(
          clientB.from(table).update(mutablePatch(table, "b-own")),
          filterB,
        ),
        "User B UPDATE immutable audit",
      );
      requireDenied(
        await applyFilter(
          clientA.from(table).update(mutablePatch(table, "a-cross")),
          filterB,
        ),
        "User A cross-owner UPDATE immutable audit",
      );
      requireDenied(
        await applyFilter(
          clientB.from(table).update(mutablePatch(table, "b-cross")),
          filterA,
        ),
        "User B cross-owner UPDATE immutable audit",
      );
      continue;
    }

    requireRows(
      await applyFilter(
        clientA
          .from(table)
          .update(mutablePatch(table, `a-${table}`))
          .select("*"),
        filterA,
      ),
      1,
      `User A UPDATE own ${table}`,
    );
    requireRows(
      await applyFilter(
        clientB
          .from(table)
          .update(mutablePatch(table, `b-${table}`))
          .select("*"),
        filterB,
      ),
      1,
      `User B UPDATE own ${table}`,
    );

    const beforeCrossB = await selectOne(
      clientB,
      table,
      graphB.rows[table],
      `User B re-read ${table} before cross UPDATE`,
    );
    requireRows(
      await applyFilter(
        clientA
          .from(table)
          .update(mutablePatch(table, `a-cross-${table}`))
          .select("*"),
        filterB,
      ),
      0,
      `User A cross-owner UPDATE ${table}`,
    );
    assert.deepEqual(
      await selectOne(
        clientB,
        table,
        graphB.rows[table],
        `User B re-read ${table} after cross UPDATE`,
      ),
      beforeCrossB,
      `User A cross UPDATE left User B ${table} unchanged`,
    );

    const beforeCrossA = await selectOne(
      clientA,
      table,
      graphA.rows[table],
      `User A re-read ${table} before cross UPDATE`,
    );
    requireRows(
      await applyFilter(
        clientB
          .from(table)
          .update(mutablePatch(table, `b-cross-${table}`))
          .select("*"),
        filterA,
      ),
      0,
      `User B cross-owner UPDATE ${table}`,
    );
    assert.deepEqual(
      await selectOne(
        clientA,
        table,
        graphA.rows[table],
        `User A re-read ${table} after cross UPDATE`,
      ),
      beforeCrossA,
      `User B cross UPDATE left User A ${table} unchanged`,
    );

    const spoofResult = await applyFilter(
      clientA
        .from(table)
        .update(ownerSpoofPatch(table, graphB, spareUsers))
        .select("*"),
      filterA,
    );
    if (!spoofResult.error) {
      requireRows(spoofResult, 0, `User A spoof-owner UPDATE ${table}`);
    }
    assert.deepEqual(
      await selectOne(
        clientA,
        table,
        graphA.rows[table],
        `User A re-read ${table} after owner spoof`,
      ),
      beforeCrossA,
      `owner spoof left User A ${table} unchanged`,
    );
  }
}

function openPayload(marker, overrides = {}) {
  return {
    candidateSnapshot: { marker },
    contracts: 1,
    dataProvenance: {
      asOf: "2026-07-01T14:29:00.000Z",
      cacheSource: "demo",
      cacheStatus: "demo",
      feed: "demo",
      sourceMode: "demo",
    },
    expirationDate: "2026-08-21",
    legs: [
      {
        contractSymbol: `${marker.toUpperCase()}260821P00025000`,
        expirationDate: "2026-08-21",
        legIndex: 0,
        openPrice: 1.25,
        optionType: "put",
        quantity: 1,
        side: "short",
        snapshot: { marker },
        strike: 25,
      },
    ],
    netCredit: 1.25,
    openedAt: "2026-07-01",
    strategyType: "short_put",
    symbol: marker.slice(0, 6).toUpperCase(),
    underlyingPriceAtOpen: 30,
    ...overrides,
  };
}

async function verifyAnonymousRpcDenials(anonymousClient) {
  const calls = [
    [
      "open_simulated_position_atomic",
      { p_input: openPayload("anon") },
    ],
    [
      "close_simulated_position_atomic",
      {
        p_close_price: 1,
        p_closed_at: "2026-07-02T15:00:00.000Z",
        p_contracts_to_close: 1,
        p_notes: "anon",
        p_position_id: randomUUID(),
      },
    ],
    [
      "expire_simulated_position_atomic",
      {
        p_expired_at: "2026-07-02T15:00:00.000Z",
        p_notes: "anon",
        p_position_id: randomUUID(),
        p_underlying_price_at_expiration: 30,
      },
    ],
    [
      "finalize_statement_import_atomic",
      {
        p_equity_lots: [],
        p_positions: [],
        p_summary: {},
        p_user_id: randomUUID(),
      },
    ],
    [
      "get_latest_simulated_position_lifecycle_events",
      { p_position_ids: [randomUUID()] },
    ],
    [
      "get_paper_account_portfolio_summary",
      {},
    ],
    [
      "get_paper_account_position_page",
      {
        p_page_size: 1,
        p_position_id: null,
        p_scope: "open",
        p_sort_at: null,
      },
    ],
    [
      "get_simulated_position_event_page",
      {
        p_event_id: null,
        p_page_size: 1,
        p_position_id: randomUUID(),
        p_sort_at: null,
      },
    ],
  ];

  for (const [name, args] of calls) {
    requireDenied(await anonymousClient.rpc(name, args), `anon RPC ${name}`);
  }
}

async function verifyPaginationRpcIsolation(
  anonymousClient,
  clientA,
  clientB,
  graphA,
  graphB,
) {
  requireDenied(
    await anonymousClient.rpc("get_paper_account_portfolio_summary"),
    "anon RPC get_paper_account_portfolio_summary",
  );
  requireDenied(
    await anonymousClient.rpc(
      "get_latest_simulated_position_lifecycle_events",
      { p_position_ids: [graphA.rows.simulated_positions.id] },
    ),
    "anon RPC get_latest_simulated_position_lifecycle_events",
  );
  requireDenied(
    await anonymousClient.rpc("get_paper_account_position_page", {
      p_page_size: 1,
      p_position_id: null,
      p_scope: "open",
      p_sort_at: null,
    }),
    "anon RPC get_paper_account_position_page",
  );
  requireDenied(
    await anonymousClient.rpc("get_simulated_position_event_page", {
      p_event_id: null,
      p_page_size: 1,
      p_position_id: graphA.rows.simulated_positions.id,
      p_sort_at: null,
    }),
    "anon RPC get_simulated_position_event_page",
  );

  const summaryA = requireRows(
    await clientA.rpc("get_paper_account_portfolio_summary"),
    1,
    "User A portfolio summary",
  )[0];
  const summaryB = requireRows(
    await clientB.rpc("get_paper_account_portfolio_summary"),
    1,
    "User B portfolio summary",
  )[0];

  assert.equal(Number(summaryA.open_position_count), 1);
  assert.equal(Number(summaryA.history_position_count), 0);
  assert.equal(Number(summaryA.cash_balance), 25_125);
  assert.equal(Number(summaryA.open_exposure), 2_500);
  assert.equal(Number(summaryA.unrealized_pnl), 15);
  assert.equal(summaryA.unrealized_pnl_status, "available");
  assert.equal(Number(summaryB.open_position_count), 1);
  assert.equal(Number(summaryB.cash_balance), 25_125);

  const pageA = requireRows(
    await clientA.rpc("get_paper_account_position_page", {
      p_page_size: 101,
      p_position_id: null,
      p_scope: "open",
      p_sort_at: null,
    }),
    1,
    "User A own open page",
  );
  assert.equal(pageA[0].id, graphA.rows.simulated_positions.id);
  requireRows(
    await clientA.rpc("get_paper_account_position_page", {
      p_page_size: 101,
      p_position_id: null,
      p_scope: "history",
      p_sort_at: null,
    }),
    0,
    "User A empty history page",
  );
  const crossOwnerTuplePage = requireSuccess(
    await clientB.rpc("get_paper_account_position_page", {
      p_page_size: 101,
      p_position_id: graphA.rows.simulated_positions.id,
      p_scope: "open",
      p_sort_at: graphA.rows.simulated_positions.opened_at,
    }),
  );
  assert.ok(
    crossOwnerTuplePage.every((row) => row.user_id === graphB.owner.userId),
    "a foreign tuple can only page through the authenticated owner's rows",
  );

  requireRows(
    await clientA.rpc("get_simulated_position_event_page", {
      p_event_id: null,
      p_page_size: 101,
      p_position_id: graphA.rows.simulated_positions.id,
      p_sort_at: null,
    }),
    1,
    "User A own event page",
  );
  requireRows(
    await clientA.rpc("get_simulated_position_event_page", {
      p_event_id: null,
      p_page_size: 101,
      p_position_id: graphB.rows.simulated_positions.id,
      p_sort_at: null,
    }),
    0,
    "User A cannot read User B event page",
  );

  const oversizedPositionPage = await clientA.rpc(
    "get_paper_account_position_page",
    {
      p_page_size: 102,
      p_position_id: null,
      p_scope: "open",
      p_sort_at: null,
    },
  );
  assert.ok(
    oversizedPositionPage.error,
    "oversized position page is rejected",
  );

  const incompleteEventTuple = await clientA.rpc(
    "get_simulated_position_event_page",
    {
      p_event_id: randomUUID(),
      p_page_size: 1,
      p_position_id: graphA.rows.simulated_positions.id,
      p_sort_at: null,
    },
  );
  assert.ok(incompleteEventTuple.error, "incomplete event tuple is rejected");

  const lifecycleEvent = requireRows(
    await clientA
      .from("simulated_position_events")
      .insert({
        id: randomUUID(),
        user_id: graphA.owner.userId,
        paper_account_id: graphA.rows.paper_accounts.id,
        position_id: graphA.rows.simulated_positions.id,
        event_type: "manual_adjustment",
        quantity: 1,
        price: 0,
        cash_delta: 0,
        realized_pnl_delta: 0,
        margin_delta: 0,
        metadata: { reason: "pagination-isolation" },
      })
      .select("*"),
    1,
    "User A create lifecycle event",
  )[0];

  const ownLifecycle = requireRows(
    await clientA.rpc(
      "get_latest_simulated_position_lifecycle_events",
      { p_position_ids: [graphA.rows.simulated_positions.id] },
    ),
    1,
    "User A own lifecycle lookup",
  );
  assert.equal(ownLifecycle[0].id, lifecycleEvent.id);

  requireRows(
    await clientA.rpc(
      "get_latest_simulated_position_lifecycle_events",
      { p_position_ids: [graphB.rows.simulated_positions.id] },
    ),
    0,
    "User A cannot read User B lifecycle",
  );
  requireRows(
    await clientA.rpc(
      "get_latest_simulated_position_lifecycle_events",
      {
        p_position_ids: [
          graphA.rows.simulated_positions.id,
          graphB.rows.simulated_positions.id,
        ],
      },
    ),
    1,
    "mixed-owner lifecycle lookup returns only User A",
  );
  requireRows(
    await clientB.rpc(
      "get_latest_simulated_position_lifecycle_events",
      { p_position_ids: [graphA.rows.simulated_positions.id] },
    ),
    0,
    "User B cannot read User A lifecycle",
  );

  const oversized = await clientA.rpc(
    "get_latest_simulated_position_lifecycle_events",
    { p_position_ids: Array.from({ length: 101 }, () => randomUUID()) },
  );
  assert.ok(oversized.error, "oversized lifecycle page is rejected");
}

async function verifyEmptyAggregate(client, ownerId) {
  const account = requireRows(
    await client
      .from("paper_accounts")
      .insert({
        current_cash: 50_000,
        margin_balance: 0,
        margin_interest_rate: 0.05,
        starting_cash: 50_000,
        user_id: ownerId,
      })
      .select("*"),
    1,
    "empty-owner paper account",
  )[0];
  const summary = requireRows(
    await client.rpc("get_paper_account_portfolio_summary"),
    1,
    "empty-owner portfolio summary",
  )[0];

  assert.equal(Number(summary.open_position_count), 0);
  assert.equal(Number(summary.history_position_count), 0);
  assert.equal(Number(summary.cash_balance), 50_000);
  assert.equal(Number(summary.margin_balance), 0);
  assert.equal(Number(summary.total_premium_collected), 0);
  assert.equal(Number(summary.realized_pnl), 0);
  assert.equal(Number(summary.open_exposure), 0);
  assert.equal(Number(summary.unrealized_pnl), 0);
  assert.equal(summary.unrealized_pnl_status, "available");

  requireRows(
    await client
      .from("paper_accounts")
      .delete()
      .eq("id", account.id)
      .select("*"),
    1,
    "delete empty-owner paper account",
  );
}

async function verifyLifecycleRpcIsolation(
  anonymousClient,
  clientA,
  clientB,
  graphA,
  graphB,
) {
  await verifyAnonymousRpcDenials(anonymousClient);

  const spoofOpen = requireSuccess(
    await clientA.rpc("open_simulated_position_atomic", {
      p_input: {
        ...openPayload("spoofa"),
        userId: graphB.owner.userId,
      },
    }),
    "User A open with spoofed input owner",
  );
  assert.equal(
    spoofOpen.position.user_id,
    graphA.owner.userId,
    "open RPC ignores spoofed owner input and derives auth.uid()",
  );

  const userBOpen = requireSuccess(
    await clientB.rpc("open_simulated_position_atomic", {
      p_input: openPayload("ownerb"),
    }),
    "User B open own position",
  );
  assert.equal(
    userBOpen.position.user_id,
    graphB.owner.userId,
    "User B open position ownership",
  );

  const beforeInvalidOpen = {
    events: await countRows(clientA, "simulated_position_events"),
    legs: await countRows(clientA, "simulated_position_legs"),
    positions: await countRows(clientA, "simulated_positions"),
  };
  const duplicateLeg = openPayload("rollback");
  duplicateLeg.legs = [
    duplicateLeg.legs[0],
    {
      ...duplicateLeg.legs[0],
      contractSymbol: "ROLLBACK260821P00024000",
    },
  ];
  const invalidOpen = await clientA.rpc("open_simulated_position_atomic", {
    p_input: duplicateLeg,
  });
  assert.ok(invalidOpen.error, "invalid open RPC fails");
  assert.deepEqual(
    {
      events: await countRows(clientA, "simulated_position_events"),
      legs: await countRows(clientA, "simulated_position_legs"),
      positions: await countRows(clientA, "simulated_positions"),
    },
    beforeInvalidOpen,
    "invalid open RPC rolls back position, leg, and event writes",
  );

  const closePosition = requireSuccess(
    await clientA.rpc("open_simulated_position_atomic", {
      p_input: openPayload("closea"),
    }),
    "User A open position for close",
  ).position;
  const closeBeforeCross = await selectOne(
    clientA,
    "simulated_positions",
    closePosition,
    "User A close position before cross-owner attempt",
  );
  const crossClose = await clientB.rpc("close_simulated_position_atomic", {
    p_close_price: 0.5,
    p_closed_at: "2026-07-02T15:00:00.000Z",
    p_contracts_to_close: 1,
    p_notes: "cross owner",
    p_position_id: closePosition.id,
  });
  assert.ok(crossClose.error, "User B cannot close User A position");
  assert.deepEqual(
    await selectOne(
      clientA,
      "simulated_positions",
      closePosition,
      "User A close position after cross-owner attempt",
    ),
    closeBeforeCross,
    "cross-owner close leaves the position unchanged",
  );

  const eventsBeforeInvalidClose = await countRows(
    clientA,
    "simulated_position_events",
  );
  const invalidClose = await clientA.rpc("close_simulated_position_atomic", {
    p_close_price: 0.5,
    p_closed_at: "2026-07-02T15:00:00.000Z",
    p_contracts_to_close: 2,
    p_notes: "invalid quantity",
    p_position_id: closePosition.id,
  });
  assert.ok(invalidClose.error, "over-quantity close RPC fails");
  assert.deepEqual(
    await selectOne(
      clientA,
      "simulated_positions",
      closePosition,
      "close position after invalid quantity",
    ),
    closeBeforeCross,
    "invalid close leaves the position unchanged",
  );
  assert.equal(
    await countRows(clientA, "simulated_position_events"),
    eventsBeforeInvalidClose,
    "invalid close emits no event",
  );

  requireSuccess(
    await clientA.rpc("close_simulated_position_atomic", {
      p_close_price: 0.5,
      p_closed_at: "2026-07-02T15:00:00.000Z",
      p_contracts_to_close: 1,
      p_notes: "owner close",
      p_position_id: closePosition.id,
    }),
    "User A closes own position",
  );

  const expirePosition = requireSuccess(
    await clientA.rpc("open_simulated_position_atomic", {
      p_input: openPayload("expirea", {
        expirationDate: "2020-01-17",
        legs: [
          {
            contractSymbol: "EXPIREA200117P00025000",
            expirationDate: "2020-01-17",
            legIndex: 0,
            openPrice: 1.25,
            optionType: "put",
            quantity: 1,
            side: "short",
            snapshot: {},
            strike: 25,
          },
        ],
        openedAt: "2020-01-01",
      }),
    }),
    "User A open position for expiration",
  ).position;
  const expireBeforeCross = await selectOne(
    clientA,
    "simulated_positions",
    expirePosition,
    "User A expiration position before cross-owner attempt",
  );
  const crossExpire = await clientB.rpc("expire_simulated_position_atomic", {
    p_expired_at: "2020-01-18T15:00:00.000Z",
    p_notes: "cross owner",
    p_position_id: expirePosition.id,
    p_underlying_price_at_expiration: 30,
  });
  assert.ok(crossExpire.error, "User B cannot expire User A position");
  assert.deepEqual(
    await selectOne(
      clientA,
      "simulated_positions",
      expirePosition,
      "User A expiration position after cross-owner attempt",
    ),
    expireBeforeCross,
    "cross-owner expiration leaves the position unchanged",
  );
  requireSuccess(
    await clientA.rpc("expire_simulated_position_atomic", {
      p_expired_at: "2020-01-18T15:00:00.000Z",
      p_notes: "owner expiration",
      p_position_id: expirePosition.id,
      p_underlying_price_at_expiration: 30,
    }),
    "User A expires own position",
  );

  const crossFinalizeCounts = {
    events: await countRows(clientA, "simulated_position_events"),
    lots: await countRows(clientA, "simulated_equity_lots"),
    positions: await countRows(clientA, "simulated_positions"),
  };
  const crossFinalize = await clientB.rpc(
    "finalize_statement_import_atomic",
    {
      p_equity_lots: [],
      p_positions: [],
      p_summary: {},
      p_user_id: graphA.owner.userId,
    },
  );
  assert.ok(crossFinalize.error, "User B cannot finalize as User A");
  assert.deepEqual(
    {
      events: await countRows(clientA, "simulated_position_events"),
      lots: await countRows(clientA, "simulated_equity_lots"),
      positions: await countRows(clientA, "simulated_positions"),
    },
    crossFinalizeCounts,
    "cross-owner finalize leaves User A graph unchanged",
  );

  const finalizeBeforeRollback = {
    events: await countRows(clientA, "simulated_position_events"),
    legs: await countRows(clientA, "simulated_position_legs"),
    positions: await countRows(clientA, "simulated_positions"),
  };
  const rollbackFingerprint = `rollback-${randomUUID()}`;
  const rollbackFinalize = await clientA.rpc(
    "finalize_statement_import_atomic",
    {
      p_equity_lots: [],
      p_positions: [
        {
          events: [
            {
              cash_delta: 100,
              created_at: "2026-07-01T15:00:00.000Z",
              event_type: "full_close",
              margin_delta: 0,
              metadata: {
                idempotencyKey: `event-${rollbackFingerprint}`,
              },
              price: 1,
              quantity: 1,
              realized_pnl_delta: 0,
            },
          ],
          externalSourceId: rollbackFingerprint,
          legs: [
            {
              expiration_date: "2026-08-21",
              leg_index: 0,
              open_price: 1,
              option_type: "put",
              quantity: 1,
              side: "short",
              snapshot: {},
              strike: 25,
            },
          ],
          position: {
            closed_at: "2026-07-01T15:00:00.000Z",
            contracts_opened: 1,
            contracts_remaining: 0,
            expiration_date: "2026-08-21",
            net_credit: 1,
            opened_at: "2026-07-01T14:30:00.000Z",
            status: "closed",
            strategy_type: "short_put",
            symbol: "ROLLBK",
            underlying_price_at_open: 30,
          },
        },
        {
          events: [],
          externalSourceId: "",
          legs: [],
          position: {},
        },
      ],
      p_summary: { rollback: true },
      p_user_id: graphA.owner.userId,
    },
  );
  assert.ok(rollbackFinalize.error, "invalid finalize RPC fails");
  assert.deepEqual(
    {
      events: await countRows(clientA, "simulated_position_events"),
      legs: await countRows(clientA, "simulated_position_legs"),
      positions: await countRows(clientA, "simulated_positions"),
    },
    finalizeBeforeRollback,
    "invalid finalize RPC rolls back all partial writes",
  );

  requireSuccess(
    await clientA.rpc("finalize_statement_import_atomic", {
      p_equity_lots: [],
      p_positions: [],
      p_summary: { owner: "A" },
      p_user_id: graphA.owner.userId,
    }),
    "User A finalizes own empty import plan",
  );
}

async function verifyAggregateParity(clientA, graphA) {
  const partialPayload = openPayload("partial", {
    contracts: 2,
    legs: [{
      contractSymbol: "PARTIAL260821P00025000",
      currentMark: 0.9,
      expirationDate: "2026-08-21",
      legIndex: 0,
      openPrice: 1.25,
      optionType: "put",
      quantity: 2,
      side: "short",
      snapshot: {},
      strike: 25,
    }],
  });
  const partial = requireSuccess(
    await clientA.rpc("open_simulated_position_atomic", {
      p_input: partialPayload,
    }),
    "open partial-close parity position",
  ).position;
  requireSuccess(
    await clientA.rpc("close_simulated_position_atomic", {
      p_close_price: 0.5,
      p_closed_at: "2026-07-02T15:00:00.000Z",
      p_contracts_to_close: 1,
      p_notes: "aggregate parity",
      p_position_id: partial.id,
    }),
    "partially close parity position",
  );

  requireSuccess(
    await clientA.rpc("open_simulated_position_atomic", {
      p_input: openPayload("spread", {
        legs: [
          {
            contractSymbol: "SPREAD260821P00095000",
            currentMark: 1.8,
            expirationDate: "2026-08-21",
            legIndex: 0,
            openPrice: 2,
            optionType: "put",
            quantity: 1,
            side: "short",
            snapshot: {},
            strike: 95,
          },
          {
            contractSymbol: "SPREAD260821P00090000",
            currentMark: 0.9,
            expirationDate: "2026-08-21",
            legIndex: 1,
            openPrice: 0.8,
            optionType: "put",
            quantity: 1,
            side: "long",
            snapshot: {},
            strike: 90,
          },
        ],
        netCredit: 1.2,
        strategyType: "put_credit_spread",
      }),
    }),
    "open multi-leg spread parity position",
  );

  const unavailable = requireSuccess(
    await clientA.rpc("open_simulated_position_atomic", {
      p_input: openPayload("nomark"),
    }),
    "open unavailable-mark parity position",
  );
  assert.equal(
    unavailable.legs[0].current_mark,
    null,
    "unavailable-mark fixture has no current mark",
  );

  const assigned = requireSuccess(
    await clientA.rpc("open_simulated_position_atomic", {
      p_input: openPayload("assign", {
        expirationDate: "2020-01-17",
        legs: [{
          contractSymbol: "ASSIGN200117P00025000",
          currentMark: 5,
          expirationDate: "2020-01-17",
          legIndex: 0,
          openPrice: 1.25,
          optionType: "put",
          quantity: 1,
          side: "short",
          snapshot: {},
          strike: 25,
        }],
        openedAt: "2020-01-01",
      }),
    }),
    "open assignment parity position",
  ).position;
  requireSuccess(
    await clientA.rpc("expire_simulated_position_atomic", {
      p_expired_at: "2020-01-18T15:00:00.000Z",
      p_notes: "assignment parity",
      p_position_id: assigned.id,
      p_underlying_price_at_expiration: 20,
    }),
    "assign parity position",
  );

  requireRows(
    await clientA
      .from("simulated_equity_lots")
      .insert({
        id: randomUUID(),
        user_id: graphA.owner.userId,
        paper_account_id: graphA.rows.paper_accounts.id,
        symbol: "CALL",
        shares: 100,
        cost_basis: 15,
        source_position_id: graphA.rows.simulated_positions.id,
        acquired_at: "2020-01-01T15:00:00.000Z",
        source_fingerprint: `parity-call-${randomUUID()}`,
      })
      .select("*"),
    1,
    "insert called-away parity lot",
  );
  const calledAway = requireSuccess(
    await clientA.rpc("open_simulated_position_atomic", {
      p_input: openPayload("call", {
        expirationDate: "2020-02-21",
        legs: [{
          contractSymbol: "CALL200221C00020000",
          currentMark: 12,
          expirationDate: "2020-02-21",
          legIndex: 0,
          openPrice: 1.25,
          optionType: "call",
          quantity: 1,
          side: "short",
          snapshot: {},
          strike: 20,
        }],
        openedAt: "2020-02-01",
        strategyType: "covered_call",
        symbol: "CALL",
      }),
    }),
    "open called-away parity position",
  ).position;
  requireSuccess(
    await clientA.rpc("expire_simulated_position_atomic", {
      p_expired_at: "2020-02-22T15:00:00.000Z",
      p_notes: "called-away parity",
      p_position_id: calledAway.id,
      p_underlying_price_at_expiration: 30,
    }),
    "call away parity position",
  );

  requireRows(
    await clientA
      .from("simulated_position_events")
      .insert({
        id: randomUUID(),
        user_id: graphA.owner.userId,
        paper_account_id: graphA.rows.paper_accounts.id,
        position_id: graphA.rows.simulated_positions.id,
        event_type: "margin_interest",
        quantity: null,
        price: null,
        cash_delta: -4.25,
        realized_pnl_delta: 0,
        margin_delta: 0,
        metadata: { parity: true },
      })
      .select("*"),
    1,
    "insert margin-interest parity event",
  );

  const [accounts, positions, legs, events, aggregate] = await Promise.all([
    clientA.from("paper_accounts").select("*"),
    clientA.from("simulated_positions").select("*"),
    clientA.from("simulated_position_legs").select("*").order("leg_index"),
    clientA.from("simulated_position_events").select("*"),
    clientA.rpc("get_paper_account_portfolio_summary"),
  ]);
  const accountRows = requireSuccess(accounts, "load parity account");
  const positionRows = requireSuccess(positions, "load parity positions");
  const legRows = requireSuccess(legs, "load parity legs");
  const eventRows = requireSuccess(events, "load parity events");
  const aggregateRow = requireRows(aggregate, 1, "load parity aggregate")[0];
  const account = accountRows[0];
  const oracle = summarizePaperAccount({
    account: {
      currentCash: Number(account.current_cash),
      marginBalance: Number(account.margin_balance),
      marginInterestRate: Number(account.margin_interest_rate),
      startingCash: Number(account.starting_cash),
    },
    events: eventRows.map((event) => ({
      cashDelta: Number(event.cash_delta),
      eventType: event.event_type,
      marginDelta: Number(event.margin_delta),
      realizedPnlDelta: Number(event.realized_pnl_delta),
    })),
    positions: positionRows.map((position) => ({
      contractsOpened: position.contracts_opened,
      contractsRemaining: position.contracts_remaining,
      id: position.id,
      legs: legRows
        .filter((leg) => leg.position_id === position.id)
        .map((leg) => ({
          askPrice: leg.ask_price == null ? null : Number(leg.ask_price),
          bidPrice: leg.bid_price == null ? null : Number(leg.bid_price),
          currentMark: leg.current_mark == null
            ? null
            : Number(leg.current_mark),
          midPrice: leg.mid_price == null ? null : Number(leg.mid_price),
          openPrice: Number(leg.open_price),
          optionType: leg.option_type,
          quantity: leg.quantity,
          side: leg.side,
          strike: leg.strike == null ? null : Number(leg.strike),
        })),
      netCredit: Number(position.net_credit),
      status: position.status,
      strategyType: position.strategy_type,
    })),
  });
  const sqlSummary = {
    cashBalance: Number(aggregateRow.cash_balance),
    marginBalance: Number(aggregateRow.margin_balance),
    marginInterestAccrued: Number(aggregateRow.margin_interest_accrued),
    marginInterestRate: Number(aggregateRow.margin_interest_rate),
    openExposure: Number(aggregateRow.open_exposure),
    realizedPnl: Number(aggregateRow.realized_pnl),
    totalPremiumCollected: Number(aggregateRow.total_premium_collected),
    unrealizedPnl: aggregateRow.unrealized_pnl == null
      ? null
      : Number(aggregateRow.unrealized_pnl),
    unrealizedPnlStatus: aggregateRow.unrealized_pnl_status,
  };

  assert.deepEqual(
    sqlSummary,
    oracle,
    "SQL aggregate matches the TypeScript accounting oracle across partial close, " +
      "spread, expiration, assignment, called-away, margin interest, and unavailable marks",
  );
  assert.equal(
    Number(aggregateRow.open_position_count),
    positionRows.filter((position) =>
      ["open", "partially_closed"].includes(position.status)
    ).length,
    "aggregate open count matches complete account data",
  );
  assert.equal(
    Number(aggregateRow.history_position_count),
    positionRows.filter((position) =>
      ["assigned", "called_away", "closed", "expired", "manual_review"]
        .includes(position.status)
    ).length,
    "aggregate history count matches complete account data",
  );
}

async function verifyAuthenticatedDeleteMatrix(
  clientA,
  clientB,
  graphA,
  graphB,
) {
  requireDenied(
    await applyFilter(
      clientA.from(AUDIT_TABLE).delete(),
      rowFilter(AUDIT_TABLE, graphA.rows[AUDIT_TABLE]),
    ),
    "User A DELETE immutable audit",
  );
  requireDenied(
    await applyFilter(
      clientB.from(AUDIT_TABLE).delete(),
      rowFilter(AUDIT_TABLE, graphB.rows[AUDIT_TABLE]),
    ),
    "User B DELETE immutable audit",
  );
  requireDenied(
    await applyFilter(
      clientA.from(AUDIT_TABLE).delete(),
      rowFilter(AUDIT_TABLE, graphB.rows[AUDIT_TABLE]),
    ),
    "User A cross-owner DELETE immutable audit",
  );
  requireDenied(
    await applyFilter(
      clientB.from(AUDIT_TABLE).delete(),
      rowFilter(AUDIT_TABLE, graphA.rows[AUDIT_TABLE]),
    ),
    "User B cross-owner DELETE immutable audit",
  );

  for (const table of DELETE_ORDER.filter((name) => name !== AUDIT_TABLE)) {
    const beforeB = await selectOne(
      clientB,
      table,
      graphB.rows[table],
      `User B ${table} before cross DELETE`,
    );
    requireRows(
      await applyFilter(
        clientA.from(table).delete().select("*"),
        rowFilter(table, graphB.rows[table]),
      ),
      0,
      `User A cross-owner DELETE ${table}`,
    );
    assert.deepEqual(
      await selectOne(
        clientB,
        table,
        graphB.rows[table],
        `User B ${table} after cross DELETE`,
      ),
      beforeB,
      `User A cross DELETE left User B ${table} unchanged`,
    );

    const beforeA = await selectOne(
      clientA,
      table,
      graphA.rows[table],
      `User A ${table} before cross DELETE`,
    );
    requireRows(
      await applyFilter(
        clientB.from(table).delete().select("*"),
        rowFilter(table, graphA.rows[table]),
      ),
      0,
      `User B cross-owner DELETE ${table}`,
    );
    assert.deepEqual(
      await selectOne(
        clientA,
        table,
        graphA.rows[table],
        `User A ${table} after cross DELETE`,
      ),
      beforeA,
      `User B cross DELETE left User A ${table} unchanged`,
    );

    requireRows(
      await applyFilter(
        clientA.from(table).delete().select("*"),
        rowFilter(table, graphA.rows[table]),
      ),
      1,
      `User A DELETE own ${table}`,
    );
    requireRows(
      await applyFilter(
        clientB.from(table).delete().select("*"),
        rowFilter(table, graphB.rows[table]),
      ),
      1,
      `User B DELETE own ${table}`,
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

const serviceVerifierPath = fileURLToPath(
  new URL("./test-supabase-service-role.mjs", import.meta.url),
);
const serviceResult = spawnSync(process.execPath, [serviceVerifierPath], {
  encoding: "utf8",
  env: {
    ...process.env,
    SUPABASE_TEST_SERVICE_ROLE_KEY: serviceRoleKey,
    SUPABASE_TEST_URL: url,
  },
});

if (serviceResult.status !== 0) {
  fail(
    `isolated service-role process failed:\n${
      serviceResult.stderr || serviceResult.stdout
    }`,
  );
}

const bootstrapLines = serviceResult.stdout.trim().split(/\r?\n/);
const bootstrap = JSON.parse(bootstrapLines.at(-1));
const anonymousClient = publicClient(url, anonKey);
const clientA = await authenticatedClient(url, anonKey, bootstrap.userA);
const clientB = await authenticatedClient(url, anonKey, bootstrap.userB);
const emptyClient = await authenticatedClient(
  url,
  anonKey,
  bootstrap.profiledSpare,
);

const graphA = await insertOwnerGraph(clientA, bootstrap.userA, "A");
const graphB = await insertOwnerGraph(clientB, bootstrap.userB, "B");
const spareUsers = {
  profiledUserId: bootstrap.profiledUserId,
  unprofiledUserId: bootstrap.unprofiledUserId,
};

await verifyAnonymousMatrix(
  anonymousClient,
  graphA,
  graphB,
  spareUsers,
);
await verifyAuthenticatedSelectAndInsertMatrix(
  clientA,
  clientB,
  graphA,
  graphB,
  spareUsers,
);
await verifySameOwnerAuditMismatch(clientA, graphA);
await verifyAuthenticatedUpdateMatrix(
  clientA,
  clientB,
  graphA,
  graphB,
  spareUsers,
);
await verifyPaginationRpcIsolation(
  anonymousClient,
  clientA,
  clientB,
  graphA,
  graphB,
);
await verifyEmptyAggregate(emptyClient, bootstrap.profiledSpare.userId);
await verifyLifecycleRpcIsolation(
  anonymousClient,
  clientA,
  clientB,
  graphA,
  graphB,
);
await verifyAggregateParity(clientA, graphA);
await verifyAuthenticatedDeleteMatrix(
  clientA,
  clientB,
  graphA,
  graphB,
);

process.stdout.write(
  `AD-009 Data API isolation passed for ${ACCOUNT_TABLES.length} tables, ` +
    "two authenticated users, anon, isolated service_role, four lifecycle RPCs, " +
    "and four bounded account-pagination RPCs.\n",
);
