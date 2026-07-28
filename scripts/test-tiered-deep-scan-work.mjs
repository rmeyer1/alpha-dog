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
  { length: 4 },
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

console.log(
  JSON.stringify({
    atomicRollbackVerified: true,
    concurrentClaims: [claimA.length, claimB.length],
    providerBackoffVerified: true,
    reclaimedCount: reclaimed.length,
    staleCompletionRejected: true,
  }),
);
