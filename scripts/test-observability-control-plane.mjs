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

const status = parseStatusEnvironment();
const url = status.API_URL;
const anonymous = client(url, status.ANON_KEY);
const service = client(url, status.SERVICE_ROLE_KEY);
const tables = [
  "observability_readiness_state",
  "observability_alert_rules",
  "observability_alert_samples",
  "observability_alert_state",
  "observability_alert_events",
];

for (const table of tables) {
  const result = await anonymous.from(table).select("*").limit(1);

  assert.ok(result.error, `anonymous SELECT ${table} must be denied`);
}

const deniedRpc = await anonymous.rpc(
  "record_observability_alert_sample",
  {
    p_alert_key: "workflow_failure",
    p_value: 1,
  },
);

assert.ok(deniedRpc.error, "anonymous alert sample RPC must be denied");

const rules = await service
  .from("observability_alert_rules")
  .select("alert_key,threshold,window_seconds,minimum_samples");

assert.ifError(rules.error);
assert.equal(rules.data?.length, 6, "service role reads six alert rules");

const owner = randomUUID();
const claim = await service.rpc(
  "claim_observability_readiness_refresh",
  {
    p_lease_seconds: 10,
    p_owner: owner,
  },
);

assert.ifError(claim.error);
assert.equal(claim.data, true, "service role claims the readiness lease");

const complete = await service.rpc(
  "complete_observability_readiness_refresh",
  {
    p_owner: owner,
    p_status: "ready",
    p_summary: {
      checks: {
        optional: { healthy: 0, total: 0 },
        required: { healthy: 1, total: 1 },
      },
      durationMs: 12,
      status: "ready",
    },
    p_ttl_seconds: 30,
  },
);

assert.ifError(complete.error);
assert.equal(complete.data, true, "service role publishes the shared aggregate");

const trigger = await service.rpc(
  "record_observability_alert_sample",
  {
    p_alert_key: "workflow_failure",
    p_value: 1,
  },
);

assert.ifError(trigger.error);
assert.equal(trigger.data?.[0]?.outcome, "triggered");

const recover = await service.rpc(
  "record_observability_alert_sample",
  {
    p_alert_key: "workflow_failure",
    p_value: 0,
  },
);

assert.ifError(recover.error);
assert.equal(recover.data?.[0]?.outcome, "recovered");

const importTrigger = await service.rpc(
  "record_observability_alert_sample",
  {
    p_alert_key: "import_finalization_failure",
    p_value: 1,
  },
);

assert.ifError(importTrigger.error);
assert.equal(importTrigger.data?.[0]?.outcome, "triggered");

const importDedup = await service.rpc(
  "record_observability_alert_sample",
  {
    p_alert_key: "import_finalization_failure",
    p_value: 1,
  },
);

assert.ifError(importDedup.error);
assert.equal(importDedup.data?.length, 0);

const importRecover = await service.rpc(
  "record_observability_alert_sample",
  {
    p_alert_key: "import_finalization_failure",
    p_value: 0,
  },
);

assert.ifError(importRecover.error);
assert.equal(importRecover.data?.[0]?.outcome, "recovered");

const staleHeartbeatAt = new Date(Date.now() - 16 * 60_000).toISOString();
const staleHeartbeat = await service
  .from("observability_readiness_state")
  .update({ updated_at: staleHeartbeatAt })
  .eq("state_key", "current");

assert.ifError(staleHeartbeat.error);

const cronMissing = await service.rpc(
  "evaluate_observability_alerts",
  { p_now: new Date().toISOString() },
);

assert.ifError(cronMissing.error);
assert.equal(
  cronMissing.data?.find(
    (event) => event.alert_key === "cron_refresh_missing",
  )?.outcome,
  "triggered",
);

const heartbeatOwner = randomUUID();
const resumeHeartbeat = await service.rpc(
  "claim_observability_readiness_refresh",
  {
    p_lease_seconds: 10,
    p_owner: heartbeatOwner,
  },
);

assert.ifError(resumeHeartbeat.error);
assert.equal(resumeHeartbeat.data, true);

const cronRecovered = await service.rpc(
  "evaluate_observability_alerts",
  { p_now: new Date().toISOString() },
);

assert.ifError(cronRecovered.error);
assert.equal(
  cronRecovered.data?.find(
    (event) => event.alert_key === "cron_refresh_missing",
  )?.outcome,
  "recovered",
);

console.log(
  `Observability Data API verifier passed (${tables.length} private tables, 11 service-role control-plane operations).`,
);
