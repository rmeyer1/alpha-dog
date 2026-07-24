import {
  context,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runWithTelemetryContext } from "./context";
import { observeProviderCall } from "./provider";
import { instrumentApiRoute } from "./route";
import { withTelemetrySpan } from "./telemetry";
import { observedWorkflowArguments } from "./workflow";

let contextManager: AsyncLocalStorageContextManager;
let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;

beforeEach(() => {
  context.disable();
  trace.disable();
  contextManager = new AsyncLocalStorageContextManager().enable();
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);
});

afterEach(async () => {
  await provider.shutdown();
  contextManager.disable();
  context.disable();
  trace.disable();
});

describe("trace correlation", () => {
  it("links provider work beneath the request span with sanitized attributes", async () => {
    const tracer = trace.getTracer("alpha-dog-test");
    const canary = "prompt-canary@example.test?token=secret";

    await tracer.startActiveSpan("request.parent", async (parent) => {
      await runWithTelemetryContext(
        {
          correlationId: "trace-correlation-1",
          route: "/api/trade/analyze",
        },
        () =>
          withTelemetrySpan(
            "provider.openai.trade_analysis",
            {
              "provider.name": "openai",
              "unsafe.value": canary,
            },
            async () => undefined,
          ),
      );
      parent.end();
    });

    const spans = exporter.getFinishedSpans();
    const parent = spans.find((span) => span.name === "request.parent");
    const child = spans.find(
      (span) => span.name === "provider.openai.trade_analysis",
    );

    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child?.spanContext().traceId).toBe(parent?.spanContext().traceId);
    expect(child?.parentSpanContext?.spanId).toBe(
      parent?.spanContext().spanId,
    );
    expect(child?.attributes).toMatchObject({
      "alpha_dog.correlation_id": "trace-correlation-1",
      "alpha_dog.route": "/api/trade/analyze",
      "provider.name": "openai",
    });
    expect(JSON.stringify(spans.map((span) => ({
      attributes: span.attributes,
      name: span.name,
      status: span.status,
    })))).not.toContain(canary);
  });

  it("marks non-thrown failed API responses as error spans", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = instrumentApiRoute(
      { method: "GET", route: "/api/trace-failure" },
      async () => Response.json(
        { error: { code: "DEPENDENCY_UNAVAILABLE" } },
        { status: 503 },
      ),
    );

    await handler(new Request("https://alpha-dog.test/api/trace-failure"));

    const span = exporter.getFinishedSpans().find(
      (candidate) => candidate.name === "api.request",
    );

    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.attributes).toMatchObject({
      "alpha_dog.route": "/api/trace-failure",
      "http.request.method": "GET",
    });

    error.mockRestore();
  });

  it("preserves browser correlation in route and durable Workflow telemetry", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = instrumentApiRoute(
      { method: "POST", route: "/api/workflow-start" },
      async () => {
        const [, durable] = await observedWorkflowArguments(
          "wheel_screener",
          { limit: 25 },
        );

        return Response.json({ durable });
      },
    );
    const response = await handler(new Request(
      "https://alpha-dog.test/api/workflow-start",
      {
        headers: {
          "x-alpha-dog-correlation-id": "browser-request-123",
        },
        method: "POST",
      },
    ));
    const body = await response.json() as {
      durable: {
        correlationId: string;
        logicalOperationId: string;
      };
    };
    const records = info.mock.calls
      .map(([value]) => String(value))
      .filter((value) =>
        value.includes('"event":"api.request"') ||
        value.includes('"event":"workflow.lifecycle"')
      )
      .map((value) => JSON.parse(value));

    expect(response.headers.get("x-alpha-dog-correlation-id")).toBe(
      "browser-request-123",
    );
    expect(body.durable.correlationId).toBe("browser-request-123");
    expect(body.durable.logicalOperationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(records).toEqual([
      expect.objectContaining({
        correlationId: "browser-request-123",
        event: "workflow.lifecycle",
        logicalOperationId: body.durable.logicalOperationId,
        outcome: "started",
      }),
      expect.objectContaining({
        correlationId: "browser-request-123",
        event: "api.request",
        route: "/api/workflow-start",
      }),
    ]);

    info.mockRestore();
  });

  it("links the sanitized provider span beneath the instrumented API route", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = instrumentApiRoute(
      { method: "GET", route: "/api/provider-link" },
      async () => {
        await observeProviderCall(
          "openai",
          "controlled_probe",
          async () => "ok",
        );

        return Response.json({ ok: true });
      },
    );

    await handler(new Request("https://alpha-dog.test/api/provider-link", {
      headers: {
        "x-alpha-dog-correlation-id": "provider-link-123",
      },
    }));

    const spans = exporter.getFinishedSpans();
    const routeSpan = spans.find((span) => span.name === "api.request");
    const providerSpan = spans.find(
      (span) => span.name === "provider.openai.controlled_probe",
    );

    expect(providerSpan?.parentSpanContext?.spanId).toBe(
      routeSpan?.spanContext().spanId,
    );
    expect(providerSpan?.spanContext().traceId).toBe(
      routeSpan?.spanContext().traceId,
    );
    expect(providerSpan?.attributes).toMatchObject({
      "alpha_dog.correlation_id": "provider-link-123",
      "alpha_dog.route": "/api/provider-link",
      "provider.name": "openai",
      "provider.operation": "controlled_probe",
    });

    info.mockRestore();
  });
});
