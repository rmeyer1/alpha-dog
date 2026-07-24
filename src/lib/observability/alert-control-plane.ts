import { waitUntil } from "@vercel/functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { emitTelemetry } from "./telemetry";

export interface PersistedAlertEvent {
  alert_key: string;
  event_id: string;
  outcome: "recovered" | "triggered";
  severity: "error" | "info" | "warn";
}

const scheduledAlertWrites = new Set<Promise<unknown>>();

function emitPersistedAlertEvents(events: PersistedAlertEvent[]) {
  for (const event of events) {
    emitTelemetry({
      alertKey: event.alert_key,
      errorCode: event.alert_key.toUpperCase(),
      event: "alert.event",
      outcome: event.outcome,
      severity: event.severity,
    });
  }
}

function controlPlaneEnabled() {
  return process.env.NODE_ENV !== "test" ||
    process.env.ALPHA_DOG_TEST_ALERT_CONTROL_PLANE === "true";
}

async function persistAlertSample(
  client: SupabaseClient,
  alertKey: string,
  value: number,
) {
  const { data, error } = await client.rpc(
    "record_observability_alert_sample",
    {
      p_alert_key: alertKey,
      p_occurred_at: new Date().toISOString(),
      p_value: value,
    },
  );

  if (error) {
    throw error;
  }

  return (data ?? []) as PersistedAlertEvent[];
}

export async function recordAlertSample(
  alertKey: string,
  value: number,
) {
  if (!controlPlaneEnabled()) {
    return null;
  }

  const client = getSupabaseAdminClient();

  if (!client) {
    return null;
  }

  return persistAlertSample(client, alertKey, value);
}

export function scheduleAlertSample(
  alertKey: string,
  value: number,
) {
  if (!controlPlaneEnabled()) {
    return false;
  }

  const client = getSupabaseAdminClient();

  if (!client) {
    return false;
  }

  const pending = persistAlertSample(client, alertKey, value)
    .then(emitPersistedAlertEvents)
    .catch((error) => {
      emitTelemetry({
        alertKey,
        error,
        errorCode: "ALERT_SAMPLE_PERSIST_FAILED",
        event: "alert.delivery_failed",
        outcome: "failed",
        severity: "error",
      });
    });

  scheduledAlertWrites.add(pending);
  void pending.finally(() => {
    scheduledAlertWrites.delete(pending);
  });

  try {
    waitUntil(pending);
  } catch {
    // Outside a Vercel request context the already-started promise remains
    // fail-open and is still awaitable by the test drain below.
  }

  return true;
}

export async function flushScheduledAlertSamplesForTests() {
  await Promise.allSettled([...scheduledAlertWrites]);
}
