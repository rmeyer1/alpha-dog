import type {
  WheelScreenerResponse,
  WheelScreenerRunResponse,
} from "@/lib/wheel/types";

export type ApiErrorPayload = { error: { code?: string; message: string } };

export function isApiErrorPayload(
  payload: unknown,
): payload is ApiErrorPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as ApiErrorPayload).error?.message === "string"
  );
}

export function isScreenerRunResponse(
  payload: WheelScreenerResponse | WheelScreenerRunResponse,
): payload is WheelScreenerRunResponse {
  return "runId" in payload;
}

export function responseErrorMessage(
  payload: unknown,
  fallback: string,
): string {
  return isApiErrorPayload(payload) ? payload.error.message : fallback;
}
