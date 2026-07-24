import {
  SpanStatusCode,
} from "@opentelemetry/api";
import {
  clientCorrelationIdFromRequest,
  CORRELATION_HEADER,
  correlationIdFromRequest,
  runWithTelemetryContext,
} from "./context";
import {
  elapsedMilliseconds,
  emitTelemetry,
  monotonicNow,
  withTelemetrySpan,
} from "./telemetry";
import { redactApiErrorResponse } from "./redaction";

type ApiRouteHandler = (...args: never[]) => Response | Promise<Response>;

export interface ApiRouteDefinition {
  method: "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT";
  route: string;
}

function responseWithCorrelationId(
  response: Response,
  correlationId: string,
) {
  try {
    response.headers.set(CORRELATION_HEADER, correlationId);

    return response;
  } catch {
    const headers = new Headers(response.headers);

    headers.set(CORRELATION_HEADER, correlationId);

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
}

function safeUnexpectedErrorResponse(correlationId: string) {
  return Response.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        correlationId,
        message: "Unable to complete this request.",
      },
    },
    {
      headers: { [CORRELATION_HEADER]: correlationId },
      status: 500,
    },
  );
}

function requestFromArguments(args: unknown[]) {
  const request = args[0];

  return request instanceof Request ? request : null;
}

function routeOutcome(status: number) {
  if (status < 400) return "success";
  if (status < 500) return "client_error";
  return "server_error";
}

export function instrumentApiRoute<T extends ApiRouteHandler>(
  definition: ApiRouteDefinition,
  handler: T,
): T {
  const instrumented = async (...args: Parameters<T>) => {
    const request = requestFromArguments(args);
    const correlationId = correlationIdFromRequest(request);
    const clientCorrelationId = clientCorrelationIdFromRequest(request) ??
      undefined;
    const startedAt = monotonicNow();

    return runWithTelemetryContext(
      {
        clientCorrelationId,
        correlationId,
        method: definition.method,
        route: definition.route,
      },
      async () =>
        withTelemetrySpan(
          "api.request",
          {
            "http.request.method": definition.method,
          },
          async (span) => {
            let response: Response;
            let thrownError: unknown;

            try {
              response = await handler(...args);

              if (!(response instanceof Response)) {
                thrownError = new TypeError(
                  "API route handler returned a non-Response value.",
                );
                response = safeUnexpectedErrorResponse(correlationId);
              }
            } catch (error) {
              thrownError = error;
              response = safeUnexpectedErrorResponse(correlationId);
            }

            response = await redactApiErrorResponse(response);
            response = responseWithCorrelationId(response, correlationId);

            emitTelemetry({
              clientCorrelationId,
              correlationId,
              durationMs: elapsedMilliseconds(startedAt),
              error: thrownError,
              errorCode:
                thrownError === undefined
                  ? `HTTP_${response.status}`
                  : "UNHANDLED_ROUTE_ERROR",
              event: "api.request",
              httpStatus: response.status,
              operation: definition.method.toLowerCase(),
              outcome: routeOutcome(response.status),
              route: definition.route,
              severity:
                response.status >= 500
                  ? "error"
                  : response.status >= 400
                    ? "warn"
                    : "info",
            });
            span.setStatus({
              code:
                response.status >= 400
                  ? SpanStatusCode.ERROR
                  : SpanStatusCode.OK,
            });

            return response;
          },
          { automaticStatus: false },
        ),
    );
  };

  return instrumented as T;
}
