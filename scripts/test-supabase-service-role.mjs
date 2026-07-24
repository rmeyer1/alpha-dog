import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import {
  ACCOUNT_TABLES,
  DELETE_ORDER,
  applyFilter,
  insertOwnerGraph,
  mutablePatch,
  rowFilter,
} from "./supabase-isolation-fixtures.mjs";

function fail(message) {
  throw new Error(`service-role verifier: ${message}`);
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

async function createTestUser(client, runId, label) {
  const email = `ad009-${runId}-${label.toLowerCase()}@example.test`;
  const password = `AD009-${label}-${runId.slice(0, 8)}!Aa9`;
  const result = await client.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  const data = requireSuccess(result, `create Auth user ${label}`);

  if (!data.user?.id) {
    fail(`create Auth user ${label}: no user id returned`);
  }

  return {
    email,
    password,
    userId: data.user.id,
  };
}

async function assertUserFunctionsDenied(client) {
  const calls = [
    [
      "open_simulated_position_atomic",
      {
        p_input: {
          contracts: 1,
          legs: [],
          strategyType: "short_put",
          symbol: "DENY",
        },
      },
    ],
    [
      "close_simulated_position_atomic",
      {
        p_close_price: 1,
        p_closed_at: "2026-07-01T15:00:00.000Z",
        p_contracts_to_close: 1,
        p_notes: "service-role denial",
        p_position_id: randomUUID(),
      },
    ],
    [
      "expire_simulated_position_atomic",
      {
        p_expired_at: "2026-07-01T15:00:00.000Z",
        p_notes: "service-role denial",
        p_position_id: randomUUID(),
        p_underlying_price_at_expiration: 1,
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
    const result = await client.rpc(name, args);
    if (!result.error || result.error.code !== "42501") {
      fail(
        `${name}: expected service_role EXECUTE denial, received ${
          result.error?.code ?? "success"
        }`,
      );
    }
  }
}

async function verifyServiceCrud(client, graph) {
  for (const table of ACCOUNT_TABLES) {
    const filter = rowFilter(table, graph.rows[table]);
    const selectResult = await applyFilter(
      client.from(table).select("*"),
      filter,
    );
    requireRows(selectResult, 1, `select ${table}`);

    const updateResult = await applyFilter(
      client
        .from(table)
        .update(mutablePatch(table, `service-${table}`))
        .select("*"),
      filter,
    );
    requireRows(updateResult, 1, `update ${table}`);
  }

  for (const table of DELETE_ORDER) {
    const filter = rowFilter(table, graph.rows[table]);
    const deleteResult = await applyFilter(
      client.from(table).delete().select("*"),
      filter,
    );
    requireRows(deleteResult, 1, `delete ${table}`);
  }
}

const url = process.env.SUPABASE_TEST_URL;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  fail("SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_ROLE_KEY are required");
}

const serviceClient = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const runId = randomUUID();
const userA = await createTestUser(serviceClient, runId, "A");
const userB = await createTestUser(serviceClient, runId, "B");
const serviceOwner = await createTestUser(serviceClient, runId, "Service");
const profiledSpare = await createTestUser(
  serviceClient,
  runId,
  "ProfiledSpare",
);
const unprofiledSpare = await createTestUser(
  serviceClient,
  runId,
  "UnprofiledSpare",
);

const serviceGraph = await insertOwnerGraph(
  serviceClient,
  serviceOwner,
  "Service",
);
await verifyServiceCrud(serviceClient, serviceGraph);

requireSuccess(
  await serviceClient.from("account_profiles").insert({
    id: profiledSpare.userId,
    email: profiledSpare.email,
    first_name: "Profiled",
    last_name: "Spare",
  }),
  "create profiled spare owner",
);

await assertUserFunctionsDenied(serviceClient);

process.stdout.write(
  `${JSON.stringify({
    profiledSpare,
    profiledUserId: profiledSpare.userId,
    unprofiledUserId: unprofiledSpare.userId,
    userA,
    userB,
  })}\n`,
);
