import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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

function requireSuccess(result, label) {
  assert.ifError(
    result.error,
    `${label}: ${result.error?.code ?? "unknown"} ${
      result.error?.message ?? ""
    }`,
  );
  return result.data;
}

const status = parseStatusEnvironment();
const anonymous = client(status.API_URL, status.ANON_KEY);
const service = client(status.API_URL, status.SERVICE_ROLE_KEY);
const tables = [
  "wheel_market_batches",
  "wheel_market_batch_underlyings",
  "wheel_market_batch_option_contracts",
  "wheel_market_batch_option_ingestions",
  "wheel_market_batch_snapshots",
  "wheel_market_batch_candidates",
  "wheel_market_batch_current_snapshots",
  "wheel_market_batch_metrics",
];

for (const table of tables) {
  const result = await anonymous.from(table).select("*").limit(1);
  assert.ok(result.error, `anonymous SELECT ${table} must be denied`);
}

const deniedRpc = await anonymous.rpc("create_wheel_market_batch", {
  p_batch_key: "denied",
  p_feed: "opra",
  p_interval_started_at: new Date().toISOString(),
});
assert.ok(deniedRpc.error, "anonymous batch creation must be denied");

const suffix = randomUUID();
const interval = new Date(
  Math.floor(Date.now() / 1000) * 1000,
).toISOString();
const [firstAttempt, competingAttempt] = await Promise.all([
  service.rpc("create_wheel_market_batch", {
    p_batch_key: `data-api:${suffix}:first`,
    p_feed: "opra",
    p_interval_started_at: interval,
  }),
  service.rpc("create_wheel_market_batch", {
    p_batch_key: `data-api:${suffix}:competitor`,
    p_feed: "opra",
    p_interval_started_at: interval,
  }),
]);
const first = requireSuccess(firstAttempt, "first concurrent batch attempt");
const competing = requireSuccess(
  competingAttempt,
  "competing concurrent batch attempt",
);

assert.equal(
  first.batch_id,
  competing.batch_id,
  "concurrent attempts must resolve to one canonical batch",
);

const batchId = first.batch_id;
const filterKey = JSON.stringify({ dteMax: 30, dteMin: 21, suffix });
const underlying = await service.from("wheel_market_batch_underlyings").insert({
  batch_id: batchId,
  captured_at: interval,
  company_name: "Apple Inc.",
  daily_volume: 1_000_000,
  dollar_volume: 200_000_000,
  earnings_context: {
    asOf: null,
    coverageThrough: null,
    events: [],
    providerEnabled: false,
    symbol: "AAPL",
  },
  exchange: "NASDAQ",
  price: 200,
  selected_for_scoring: true,
  stock_score: 100,
  stock_snapshot: {},
  symbol: "AAPL",
  trend: "bullish",
  universe_rank: 1,
});
requireSuccess(underlying, "persist batch underlying");

requireSuccess(
  await service.rpc("checkpoint_wheel_market_batch_underlyings", {
    p_asset_count: 1,
    p_batch_id: batchId,
    p_ranked_count: 1,
    p_selected_count: 1,
    p_summary: { selectedSymbols: ["AAPL"] },
  }),
  "checkpoint shared underlyings",
);

requireSuccess(
  await service.from("wheel_market_batch_option_contracts").insert({
    ask: 2.6,
    batch_id: batchId,
    bid: 2.5,
    captured_at: interval,
    contract_symbol: `AAPL260821P00190000${suffix.slice(0, 4)}`,
    delta: -0.24,
    expiration: "2026-08-21",
    implied_volatility: 0.32,
    open_interest: 1_000,
    option_type: "put",
    strike: 190,
    underlying_symbol: "AAPL",
    volume: 500,
  }),
  "persist batch option contract",
);

requireSuccess(
  await service.from("wheel_market_batch_option_ingestions").insert({
    batch_id: batchId,
    contract_count: 1,
    duration_ms: 10,
    option_type: "put",
    status: "complete",
    symbol: "AAPL",
  }),
  "checkpoint option ingestion",
);

requireSuccess(
  await service.rpc("complete_wheel_market_batch_facts", {
    p_asset_count: 1,
    p_batch_id: batchId,
    p_error_count: 0,
    p_option_contract_count: 1,
    p_ranked_count: 1,
    p_selected_count: 1,
    p_summary: { errors: [], ingestion: { selectedCount: 1 } },
  }),
  "complete batch facts",
);

const snapshot = requireSuccess(
  await service.rpc("create_wheel_market_batch_snapshot", {
    p_as_of: interval,
    p_batch_id: batchId,
    p_feed: "opra",
    p_filter_key: filterKey,
    p_filters: { dteMax: 30, dteMin: 21 },
    p_next_suggested_refresh_at: new Date(
      new Date(interval).getTime() + 15 * 60_000,
    ).toISOString(),
    p_persona: "balanced_wheel",
    p_result_limit: 50,
    p_strategy: "short_put",
  }),
  "create batch snapshot",
);
const snapshotId = snapshot.snapshot_id;
const unpublished = requireSuccess(
  await service
    .from("wheel_market_batch_current_snapshots")
    .select("snapshot_id")
    .eq("filter_key", filterKey),
  "read unpublished pointer",
);
assert.equal(
  unpublished.length,
  0,
  "building snapshots must be invisible",
);

requireSuccess(
  await service.from("wheel_market_batch_candidates").insert({
    annualized_yield: 0.18,
    as_of: interval,
    company_name: "Apple Inc.",
    delta: -0.24,
    dte: 25,
    errors: [],
    exchange: "NASDAQ",
    expiration: "2026-08-21",
    implied_volatility: 0.32,
    liquidity_quality: "excellent",
    option_type: "put",
    premium_received: 250,
    premium_yield: 0.0132,
    rank: 1,
    score: 88,
    short_strike: 190,
    snapshot_id: snapshotId,
    strategy: "short_put",
    symbol: "AAPL",
    trend: "bullish",
    underlying_as_of: interval,
    underlying_price: 200,
    warning_count: 0,
    warnings: [],
  }),
  "persist snapshot candidate",
);

requireSuccess(
  await service.rpc("publish_wheel_market_batch_snapshot", {
    p_candidate_count: 1,
    p_errors: [],
    p_screened_count: 1,
    p_skipped_count: 0,
    p_snapshot_id: snapshotId,
    p_warnings: [],
  }),
  "publish complete snapshot",
);

const published = requireSuccess(
  await service
    .from("wheel_market_batch_current_snapshots")
    .select("snapshot_id")
    .eq("filter_key", filterKey)
    .single(),
  "read published pointer",
);
assert.equal(published.snapshot_id, snapshotId);

requireSuccess(
  await service.rpc("complete_wheel_market_batch", {
    p_batch_id: batchId,
    p_expected_snapshot_count: 1,
  }),
  "complete market batch",
);

const failedInterval = new Date(
  new Date(interval).getTime() + 1,
).toISOString();
const failedBatch = requireSuccess(
  await service.rpc("create_wheel_market_batch", {
    p_batch_key: `data-api:${suffix}:failed`,
    p_feed: "opra",
    p_interval_started_at: failedInterval,
  }),
  "create failed replacement batch",
);
requireSuccess(
  await service.rpc("fail_wheel_market_batch", {
    p_batch_id: failedBatch.batch_id,
    p_error: "controlled provider failure",
  }),
  "fail replacement batch",
);

const retained = requireSuccess(
  await service
    .from("wheel_market_batch_current_snapshots")
    .select("snapshot_id")
    .eq("filter_key", filterKey)
    .single(),
  "read retained pointer",
);
assert.equal(
  retained.snapshot_id,
  snapshotId,
  "failed replacement must retain the previous complete snapshot",
);

requireSuccess(
  await service
    .from("wheel_market_batch_current_snapshots")
    .delete()
    .eq("filter_key", filterKey),
  "remove verification pointer",
);
requireSuccess(
  await service
    .from("wheel_market_batches")
    .delete()
    .in("id", [batchId, failedBatch.batch_id]),
  "remove verification batches",
);

console.log(
  `Shared market-batch Data API verifier passed (${tables.length} private tables, two concurrent attempts, atomic publication, failure retention).`,
);
