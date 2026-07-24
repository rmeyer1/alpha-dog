import { registerOTel } from "@vercel/otel";
import type { Instrumentation } from "next";
import { emitTelemetry } from "@/lib/observability/telemetry";

const thirdPartyProviderUrls = [
  /alpaca\.markets/i,
  /finnhub\.io/i,
  /logo\.dev/i,
  /openai\.com/i,
  /polymarket\.com/i,
  /supabase\.co/i,
];

export function register() {
  registerOTel({
    instrumentationConfig: {
      fetch: {
        dontPropagateContextUrls: thirdPartyProviderUrls,
        ignoreUrls: thirdPartyProviderUrls,
        propagateContextUrls: [],
      },
    },
    serviceName: "alpha-dog",
  });
}

export const onRequestError: Instrumentation.onRequestError = (
  error,
  _request,
  context,
) => {
  emitTelemetry({
    error,
    errorCode: "UNHANDLED_NEXT_ERROR",
    event: "next.request_error",
    operation: context.routeType,
    outcome: "server_error",
    route: context.routePath,
    severity: "error",
  });
};
