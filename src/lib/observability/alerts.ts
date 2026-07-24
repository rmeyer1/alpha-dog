import { emitTelemetry, type TelemetrySeverity } from "./telemetry";

export const ALERT_RULES = {
  cron_refresh_missing: {
    cooldownSeconds: 900,
    destination: "vercel_runtime_alerts",
    minimumSamples: 1,
    owner: "alpha_dog_operations",
    recoveryConsecutiveSamples: 1,
    severity: "error",
    threshold: 1,
    windowSeconds: 900,
  },
  import_finalization_failure: {
    cooldownSeconds: 300,
    destination: "vercel_runtime_alerts",
    minimumSamples: 1,
    owner: "alpha_dog_operations",
    recoveryConsecutiveSamples: 1,
    severity: "error",
    threshold: 1,
    windowSeconds: 300,
  },
  paid_usage_anomaly: {
    cooldownSeconds: 900,
    destination: "vercel_runtime_alerts",
    minimumSamples: 20,
    owner: "alpha_dog_operations",
    recoveryConsecutiveSamples: 3,
    severity: "warn",
    threshold: 0.2,
    windowSeconds: 900,
  },
  provider_error_rate: {
    cooldownSeconds: 300,
    destination: "vercel_runtime_alerts",
    minimumSamples: 20,
    owner: "alpha_dog_operations",
    recoveryConsecutiveSamples: 3,
    severity: "warn",
    threshold: 0.1,
    windowSeconds: 300,
  },
  stale_screener_snapshot: {
    cooldownSeconds: 900,
    destination: "vercel_runtime_alerts",
    minimumSamples: 1,
    owner: "alpha_dog_operations",
    recoveryConsecutiveSamples: 1,
    severity: "warn",
    threshold: 30,
    windowSeconds: 900,
  },
  workflow_failure: {
    cooldownSeconds: 300,
    destination: "vercel_runtime_alerts",
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

const lastTriggeredAt = new Map<AlertKey, number>();

const runtimeLogAlertAdapter: AlertAdapter = (event) => {
  emitTelemetry({
    alertKey: event.alertKey,
    errorCode: event.alertKey.toUpperCase(),
    event: "alert.event",
    outcome: event.outcome,
    severity: event.outcome === "recovered" ? "info" : event.severity,
  });
};

export async function dispatchAlert(
  alertKey: AlertKey,
  outcome: AlertOutcome,
  adapter: AlertAdapter = runtimeLogAlertAdapter,
) {
  const rule = ALERT_RULES[alertKey];
  const now = Date.now();
  const lastTriggered = lastTriggeredAt.get(alertKey) ?? 0;

  if (
    outcome === "triggered" &&
    now - lastTriggered < rule.cooldownSeconds * 1000
  ) {
    emitTelemetry({
      alertKey,
      event: "alert.deduplicated",
      outcome: "cooldown",
      severity: "debug",
    });

    return false;
  }

  if (outcome === "triggered") {
    lastTriggeredAt.set(alertKey, now);
  } else {
    lastTriggeredAt.delete(alertKey);
  }

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
  }

  return true;
}

export function resetAlertStateForTests() {
  lastTriggeredAt.clear();
}
