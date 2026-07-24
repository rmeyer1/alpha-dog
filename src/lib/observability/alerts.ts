import { emitTelemetry, type TelemetrySeverity } from "./telemetry";
import { scheduleAlertSample } from "./alert-control-plane";

export const ALERT_RULES = {
  cron_refresh_missing: {
    cooldownSeconds: 900,
    destination: "supabase_observability_alert_events",
    minimumSamples: 1,
    owner: "alpha_dog_operations",
    recoveryConsecutiveSamples: 1,
    severity: "error",
    threshold: 1,
    windowSeconds: 900,
  },
  import_finalization_failure: {
    cooldownSeconds: 300,
    destination: "supabase_observability_alert_events",
    minimumSamples: 1,
    owner: "alpha_dog_operations",
    recoveryConsecutiveSamples: 1,
    severity: "error",
    threshold: 1,
    windowSeconds: 300,
  },
  paid_usage_anomaly: {
    cooldownSeconds: 900,
    destination: "supabase_observability_alert_events",
    minimumSamples: 20,
    owner: "alpha_dog_operations",
    recoveryConsecutiveSamples: 3,
    severity: "warn",
    threshold: 0.2,
    windowSeconds: 900,
  },
  provider_error_rate: {
    cooldownSeconds: 300,
    destination: "supabase_observability_alert_events",
    minimumSamples: 20,
    owner: "alpha_dog_operations",
    recoveryConsecutiveSamples: 3,
    severity: "warn",
    threshold: 0.1,
    windowSeconds: 300,
  },
  stale_screener_snapshot: {
    cooldownSeconds: 900,
    destination: "supabase_observability_alert_events",
    minimumSamples: 1,
    owner: "alpha_dog_operations",
    recoveryConsecutiveSamples: 1,
    severity: "warn",
    threshold: 30,
    windowSeconds: 900,
  },
  workflow_failure: {
    cooldownSeconds: 300,
    destination: "supabase_observability_alert_events",
    minimumSamples: 1,
    owner: "alpha_dog_operations",
    recoveryConsecutiveSamples: 1,
    severity: "error",
    threshold: 1,
    windowSeconds: 300,
  },
} as const satisfies Record<
  string,
  {
    cooldownSeconds: number;
    destination: string;
    minimumSamples: number;
    owner: string;
    recoveryConsecutiveSamples: number;
    severity: TelemetrySeverity;
    threshold: number;
    windowSeconds: number;
  }
>;

export type AlertKey = keyof typeof ALERT_RULES;
export type AlertOutcome = "triggered" | "recovered";

export interface AlertAdapterEvent {
  alertKey: AlertKey;
  outcome: AlertOutcome;
  severity: TelemetrySeverity;
}

export type AlertAdapter = (
  event: AlertAdapterEvent,
) => void | Promise<void>;

const durableAlertAdapter: AlertAdapter = (event) => {
  const scheduled = scheduleAlertSample(
    event.alertKey,
    event.outcome === "triggered" ? 1 : 0,
  );

  if (!scheduled) {
    throw new Error("The observability alert control plane is unavailable.");
  }
};

export async function dispatchAlert(
  alertKey: AlertKey,
  outcome: AlertOutcome,
  adapter: AlertAdapter = durableAlertAdapter,
) {
  const rule = ALERT_RULES[alertKey];

  try {
    await adapter({
      alertKey,
      outcome,
      severity: rule.severity,
    });
  } catch (error) {
    emitTelemetry({
      alertKey,
      error,
      errorCode: "ALERT_ADAPTER_FAILED",
      event: "alert.delivery_failed",
      outcome: "failed",
      severity: "error",
    });

    return false;
  }

  return true;
}
