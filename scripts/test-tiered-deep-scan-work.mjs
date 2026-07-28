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

async function readyBatch(service, interval, label) {
  const batch = requireSuccess(
    await service.rpc("create_wheel_market_batch", {
      p_batch_key: `tiered-data-api:${label}:${randomUUID()}`,
      p_feed: "opra",
      p_interval_started_at: interval,
    }),
    `create ${label} batch`,
  );
  requireSuccess(
    await service.rpc("complete_wheel_market_batch_facts", {
      p_asset_count: 0,
      p_batch_id: batch.batch_id,
      p_error_count: 0,
      p_option_contract_count: 0,
      p_ranked_count: 0,
      p_selected_count: 0,
      p_summary: { errors: [] },
    }),
    `ready ${label} batch`,
  );
  return batch.batch_id;
}

const status = parseStatusEnvironment();
const anonymous = client(status.API_URL, status.ANON_KEY);
const service = client(status.API_URL, status.SERVICE_ROLE_KEY);

assert.ok(
  (await anonymous.from("wheel_deep_scan_work").select("*").limit(1)).error,
  "anonymous queue reads must be denied",
);
assert.ok(
  (await anonymous.rpc("claim_wheel_deep_scan_work", {
    p_force: true,
    p_lease_seconds: 30,
    p_limit: 1,
    p_now: new Date().toISOString(),
    p_owner_id: randomUUID(),
  })).error,
  "anonymous queue claims must be denied",
);

const prefix = randomUUID().replaceAll("-", "").slice(0, 5).toUpperCase();
const symbols = Array.from(
  { length: 317 },
  (_, index) => `Q${prefix}${index}`,
);
requireSuccess(
  await service.from("wheel_underlying_universe").upsert(
    symbols.map((symbol) => ({
      active: true,
      company_name: `Tiered verifier ${symbol}`,
      exchange: "NASDAQ",
      optionable: true,
      symbol,
    })),
  ),
  "seed verifier universe",
);

const startedAt = new Date(
  Math.floor(Date.now() / 1000) * 1000,
).toISOString();
requireSuccess(
  await service.rpc("sync_wheel_deep_scan_work_queue", {
    p_now: startedAt,
  }),
  "sync queue",
);

const ownerA = randomUUID();
const ownerB = randomUUID();
const [claimAResult, claimBResult] = await Promise.all([
  service.rpc("claim_wheel_deep_scan_work", {
    p_force: false,
    p_lease_seconds: 30,
    p_limit: 2,
    p_now: startedAt,
    p_owner_id: ownerA,
  }),
  service.rpc("claim_wheel_deep_scan_work", {
    p_force: false,
    p_lease_seconds: 30,
    p_limit: 2,
    p_now: startedAt,
    p_owner_id: ownerB,
  }),
]);
const claimA = requireSuccess(claimAResult, "concurrent claim A");
const claimB = requireSuccess(claimBResult, "concurrent claim B");
const identity = (claim) => `${claim.symbol}:${claim.option_type}`;

assert.equal(claimA.length, 2);
assert.equal(claimB.length, 2);
assert.deepEqual(
  new Set(claimA.map(identity)).intersection(new Set(claimB.map(identity))),
  new Set(),
  "concurrent schedulers must claim disjoint work",
);

const reclaimAt = new Date(
  new Date(startedAt).getTime() + 31_000,
).toISOString();
const ownerC = randomUUID();
const reclaimed = requireSuccess(
  await service.rpc("claim_wheel_deep_scan_work", {
    p_force: false,
    p_lease_seconds: 60,
    p_limit: 8,
    p_now: reclaimAt,
    p_owner_id: ownerC,
  }),
  "reclaim expired work",
);
assert.ok(
  reclaimed.some((claim) => identity(claim) === identity(claimA[0])),
  "expired work must be reclaimable",
);

const reclaimedPriorClaim = reclaimed.find(
  (claim) => identity(claim) === identity(claimA[0]),
);
assert.ok(reclaimedPriorClaim);
const fencedFilterKey = `ad019-fenced-${prefix}`;
const compatibilityCoverage = [{
  best_score: 95,
  error: null,
  filter_key: fencedFilterKey,
  option_contract_count: 0,
  option_type: reclaimedPriorClaim.option_type,
  persona: "balanced_wheel",
  scan_run_id: null,
  status: "complete",
  strategy: reclaimedPriorClaim.option_type === "put"
    ? "short_put"
    : "covered_call",
  symbol: reclaimedPriorClaim.symbol,
}];
const compatibilityCandidates = [{
  annualized_return_on_risk: null,
  annualized_yield: 0.24,
  company_name: "Fenced compatibility verifier",
  delta: -0.25,
  dte: 25,
  errors: [],
  exchange: "NASDAQ",
  expiration: "2026-08-21",
  filter_key: fencedFilterKey,
  implied_volatility: 0.3,
  liquidity_quality: "good",
  long_strike: null,
  ma20: 99,
  ma50: 98,
  ma200: 95,
  option_type: reclaimedPriorClaim.option_type,
  persona: "balanced_wheel",
  premium_received: 2.5,
  premium_yield: 0.025,
  return_on_risk: null,
  rsi14: 55,
  scan_run_id: null,
  score: 95,
  short_strike: 100,
  strategy: reclaimedPriorClaim.option_type === "put"
    ? "short_put"
    : "covered_call",
  symbol: reclaimedPriorClaim.symbol,
  trend: "bullish",
  underlying_as_of: reclaimAt,
  underlying_price: 105,
  warning_count: 0,
  warnings: [],
}];
const stalePublication = await service.rpc(
  "publish_wheel_deep_scan_compatibility",
  {
    p_candidates: compatibilityCandidates,
    p_claims: [{
      lease_token: claimA[0].lease_token,
      option_type: claimA[0].option_type,
      symbol: claimA[0].symbol,
    }],
    p_coverage: compatibilityCoverage,
    p_lease_seconds: 60,
    p_now: reclaimAt,
    p_owner_id: ownerA,
  },
);
assert.ok(
  stalePublication.error,
  "a reclaim after validation must reject stale compatibility publication",
);
const staleCoverage = requireSuccess(
  await service
    .from("wheel_deep_scan_coverage")
    .select("symbol")
    .eq("filter_key", fencedFilterKey),
  "read stale compatibility state",
);
assert.equal(
  staleCoverage.length,
  0,
  "rejected stale publication must not mutate legacy coverage",
);
const staleCandidates = requireSuccess(
  await service
    .from("wheel_deep_scan_candidates")
    .select("symbol")
    .eq("filter_key", fencedFilterKey),
  "read stale compatibility candidate state",
);
assert.equal(
  staleCandidates.length,
  0,
  "rejected stale publication must not mutate legacy candidates",
);
requireSuccess(
  await service.rpc("publish_wheel_deep_scan_compatibility", {
    p_candidates: compatibilityCandidates,
    p_claims: [{
      lease_token: reclaimedPriorClaim.lease_token,
      option_type: reclaimedPriorClaim.option_type,
      symbol: reclaimedPriorClaim.symbol,
    }],
    p_coverage: compatibilityCoverage,
    p_lease_seconds: 60,
    p_now: reclaimAt,
    p_owner_id: ownerC,
  }),
  "publish fenced compatibility state",
);
const publishedCandidates = requireSuccess(
  await service
    .from("wheel_deep_scan_candidates")
    .select("symbol,score")
    .eq("filter_key", fencedFilterKey),
  "read current-owner compatibility candidate state",
);
assert.deepEqual(publishedCandidates, [{
  score: 95,
  symbol: reclaimedPriorClaim.symbol,
}]);
requireSuccess(
  await service.rpc("publish_wheel_deep_scan_compatibility", {
    p_candidates: [],
    p_claims: [{
      lease_token: reclaimedPriorClaim.lease_token,
      option_type: reclaimedPriorClaim.option_type,
      symbol: reclaimedPriorClaim.symbol,
    }],
    p_coverage: [{
      ...compatibilityCoverage[0],
      best_score: null,
      status: "no_candidate",
    }],
    p_lease_seconds: 60,
    p_now: reclaimAt,
    p_owner_id: ownerC,
  }),
  "remove stale compatibility candidate atomically",
);
const removedCandidates = requireSuccess(
  await service
    .from("wheel_deep_scan_candidates")
    .select("symbol")
    .eq("filter_key", fencedFilterKey),
  "read removed compatibility candidate state",
);
assert.equal(
  removedCandidates.length,
  0,
  "a current no-candidate publication removes the stale legacy candidate",
);

const batchId = await readyBatch(service, startedAt, "completion");
const completionClaims = reclaimed.slice(0, 2);
const malformedResults = completionClaims.map((claim, index) => ({
  error: null,
  lease_token: index === 1 ? randomUUID() : claim.lease_token,
  option_contract_count: index,
  option_type: claim.option_type,
  outcome: index === 0 ? "provider_outage" : "complete",
  symbol: claim.symbol,
}));
const rejected = await service.rpc(
  "complete_wheel_deep_scan_work_batch",
  {
    p_batch_id: batchId,
    p_now: reclaimAt,
    p_owner_id: ownerC,
    p_results: malformedResults,
  },
);
assert.ok(rejected.error, "a stale member must reject the whole completion");

const retained = requireSuccess(
  await service
    .from("wheel_deep_scan_work")
    .select("symbol,option_type,lease_owner_id")
    .in("symbol", completionClaims.map((claim) => claim.symbol)),
  "read rollback state",
).filter((row) =>
  completionClaims.some((claim) => identity(row) === identity(claim))
);
assert.equal(retained.length, 2);
assert.ok(
  retained.every((row) => row.lease_owner_id === ownerC),
  "rejected batch completion must retain every lease",
);

const completed = requireSuccess(
  await service.rpc("complete_wheel_deep_scan_work_batch", {
    p_batch_id: batchId,
    p_now: reclaimAt,
    p_owner_id: ownerC,
    p_results: completionClaims.map((claim, index) => ({
      error: index === 0 ? "provider unavailable" : null,
      lease_token: claim.lease_token,
      option_contract_count: index,
      option_type: claim.option_type,
      outcome: index === 0 ? "provider_outage" : "complete",
      symbol: claim.symbol,
    })),
  }),
  "complete atomic claim batch",
);
assert.equal(completed.completed_count, 2);
const exactResults = completionClaims.map((claim, index) => ({
  error: index === 0 ? "provider unavailable" : null,
  lease_token: claim.lease_token,
  option_contract_count: index,
  option_type: claim.option_type,
  outcome: index === 0 ? "provider_outage" : "complete",
  symbol: claim.symbol,
}));
const replayed = requireSuccess(
  await service.rpc("complete_wheel_deep_scan_work_batch", {
    p_batch_id: batchId,
    p_now: reclaimAt,
    p_owner_id: ownerC,
    p_results: exactResults,
  }),
  "replay exact completion",
);
assert.equal(replayed.replayed_count, 2);
const alteredReplay = await service.rpc(
  "complete_wheel_deep_scan_work_batch",
  {
    p_batch_id: batchId,
    p_now: reclaimAt,
    p_owner_id: ownerC,
    p_results: exactResults.map((result, index) => index === 0
      ? {
        ...result,
        error: "materially altered replay",
        option_contract_count: 999,
      }
      : result),
  },
);
assert.ok(
  alteredReplay.error,
  "a materially altered completion replay must be rejected",
);

const providerRow = requireSuccess(
  await service
    .from("wheel_deep_scan_work")
    .select("next_due_at,last_outcome,consecutive_failure_count")
    .eq("symbol", completionClaims[0].symbol)
    .eq("option_type", completionClaims[0].option_type)
    .single(),
  "read provider backoff",
);
assert.equal(providerRow.last_outcome, "provider_outage");
assert.equal(providerRow.consecutive_failure_count, 1);
assert.equal(
  Date.parse(providerRow.next_due_at) - Date.parse(reclaimAt),
  300_000,
  "priority provider outage must use the configured five-minute backoff",
);

const staleBatchId = await readyBatch(service, startedAt, "stale");
const stale = await service.rpc("complete_wheel_deep_scan_work_batch", {
  p_batch_id: staleBatchId,
  p_now: reclaimAt,
  p_owner_id: ownerA,
  p_results: [{
    error: null,
    lease_token: claimA[0].lease_token,
    option_contract_count: 0,
    option_type: claimA[0].option_type,
    outcome: "no_candidate",
    symbol: claimA[0].symbol,
  }],
});
assert.ok(stale.error, "an expired prior owner must not complete reclaimed work");

const benchmarkOwner = randomUUID();
const benchmarkAt = new Date(
  new Date(reclaimAt).getTime() + 1000,
).toISOString();
const claimStartedAt = performance.now();
const benchmarkClaims = requireSuccess(
  await service.rpc("claim_wheel_deep_scan_work", {
    p_force: true,
    p_lease_seconds: 3600,
    p_limit: 625,
    p_now: benchmarkAt,
    p_owner_id: benchmarkOwner,
  }),
  "claim 625-unit benchmark batch",
);
const claimMs = performance.now() - claimStartedAt;
assert.equal(benchmarkClaims.length, 625);
const heartbeatStartedAt = performance.now();
requireSuccess(
  await service.rpc("heartbeat_wheel_deep_scan_work", {
    p_claims: benchmarkClaims.map((claim) => ({
      lease_token: claim.lease_token,
      option_type: claim.option_type,
      symbol: claim.symbol,
    })),
    p_lease_seconds: 3600,
    p_now: benchmarkAt,
    p_owner_id: benchmarkOwner,
  }),
  "heartbeat 625-unit benchmark batch",
);
const heartbeatMs = performance.now() - heartbeatStartedAt;
const benchmarkBatchId = await readyBatch(
  service,
  benchmarkAt,
  "benchmark",
);
const completionStartedAt = performance.now();
requireSuccess(
  await service.rpc("complete_wheel_deep_scan_work_batch", {
    p_batch_id: benchmarkBatchId,
    p_now: benchmarkAt,
    p_owner_id: benchmarkOwner,
    p_results: benchmarkClaims.map((claim) => ({
      error: null,
      lease_token: claim.lease_token,
      option_contract_count: 0,
      option_type: claim.option_type,
      outcome: "no_candidate",
      symbol: claim.symbol,
    })),
  }),
  "complete 625-unit benchmark batch",
);
const completionMs = performance.now() - completionStartedAt;

console.log(
  JSON.stringify({
    alteredReplayRejected: true,
    atomicRollbackVerified: true,
    compatibilityCandidateLifecycleVerified: true,
    concurrentClaims: [claimA.length, claimB.length],
    mutationTimeFenceVerified: true,
    providerBackoffVerified: true,
    queueBenchmarksMs: {
      claim625: claimMs,
      complete625: completionMs,
      heartbeat625: heartbeatMs,
    },
    reclaimedCount: reclaimed.length,
    staleCompletionRejected: true,
  }),
);
