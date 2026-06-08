import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";

vi.mock("workflow/api", () => ({
  start: vi.fn(),
}));

vi.mock("@/workflows/wheel-screener", () => ({
  wheelScreenerWorkflow: vi.fn(),
}));

function stubLiveEnv() {
  vi.stubEnv("USE_DEMO_DATA", "false");
  vi.stubEnv("APCA_API_KEY_ID", "alpaca-key");
  vi.stubEnv("APCA_API_SECRET_KEY", "alpaca-secret");
  vi.stubEnv("ALPACA_OPTIONS_FEED", "indicative");
  vi.stubEnv("SIGNAL_SCRIBE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SIGNAL_SCRIBE_SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  vi.stubEnv("OPTIONS_INDEX_CRON_SECRET", "options-secret");
}

async function importRoute() {
  return await import("./route");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.useFakeTimers();
  vi.setSystemTime("2026-06-08T14:00:00.000Z");
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(start).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("options index refresh route", () => {
  it("rejects requests with the wrong cron secret", async () => {
    stubLiveEnv();

    const { POST } = await importRoute();
    const response = await POST(
      new Request(
        "https://alpha-dog.example/api/cron/wheel/options-index-refresh",
        {
          method: "POST",
          headers: {
            authorization: "Bearer wrong-secret",
          },
        },
      ),
    );

    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("accepts CRON_SECRET for the Vercel daily fallback", async () => {
    stubLiveEnv();
    vi.stubEnv("OPTIONS_INDEX_CRON_SECRET", "");
    vi.stubEnv("CRON_SECRET", "vercel-secret");
    vi.setSystemTime("2026-06-08T12:00:00.000Z");

    const { GET } = await importRoute();
    const response = await GET(
      new Request(
        "https://alpha-dog.example/api/cron/wheel/options-index-refresh",
        {
          headers: {
            authorization: "Bearer vercel-secret",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(start).not.toHaveBeenCalled();
  });

  it("starts all due strategy refreshes during market hours", async () => {
    stubLiveEnv();
    vi.mocked(fetch).mockImplementation(async () =>
      new Response(JSON.stringify([]), { status: 200 }),
    );
    vi.mocked(start).mockImplementation(async () => ({
      runId: `run-${vi.mocked(start).mock.calls.length}`,
      status: Promise.resolve("running"),
    }) as never);

    const { POST } = await importRoute();
    const response = await POST(
      new Request(
        "https://alpha-dog.example/api/cron/wheel/options-index-refresh",
        {
          method: "POST",
          headers: {
            authorization: "Bearer options-secret",
          },
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      configuredCount: 4,
      dueCount: 4,
    });
    expect(body.started).toHaveLength(4);
    expect(start).toHaveBeenCalledTimes(4);
    const strategies = vi.mocked(start).mock.calls.map((call) => {
      const args = call[1] as unknown as Array<{ strategy: string }>;

      return args[0].strategy;
    });

    expect(strategies).toEqual([
      "short_put",
      "put_credit_spread",
      "covered_call",
      "call_credit_spread",
    ]);
  });

  it("no-ops outside market hours before querying Supabase", async () => {
    stubLiveEnv();
    vi.setSystemTime("2026-06-08T12:00:00.000Z");

    const { POST } = await importRoute();
    const response = await POST(
      new Request(
        "https://alpha-dog.example/api/cron/wheel/options-index-refresh",
        {
          method: "POST",
          headers: {
            authorization: "Bearer options-secret",
          },
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      skippedMarketHours: true,
      started: [],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});
