import { beforeEach, describe, expect, it, vi } from "vitest";

const requestSupabaseRestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/rest", () => ({
  requestSupabaseRest: requestSupabaseRestMock,
}));

beforeEach(() => {
  requestSupabaseRestMock.mockReset();
});

describe("scanner concurrency", () => {
  it("sorts composite conflict keys before chunking", async () => {
    requestSupabaseRestMock.mockResolvedValue(null);
    const { upsertScannerRows } = await import("./scanner-concurrency");

    await upsertScannerRows(
      "wheel_deep_scan_coverage",
      [
        { symbol: "MSFT", persona: "balanced", strategy: "short_put" },
        { symbol: "AAPL", persona: "balanced", strategy: "short_put" },
        { symbol: "AAPL", persona: "aggressive", strategy: "short_put" },
      ],
      "symbol,persona,strategy",
      { chunkSize: 2 },
    );

    expect(requestSupabaseRestMock).toHaveBeenCalledTimes(2);
    expect(requestSupabaseRestMock.mock.calls[0][1].body).toEqual([
      { symbol: "AAPL", persona: "aggressive", strategy: "short_put" },
      { symbol: "AAPL", persona: "balanced", strategy: "short_put" },
    ]);
    expect(requestSupabaseRestMock.mock.calls[1][1].body).toEqual([
      { symbol: "MSFT", persona: "balanced", strategy: "short_put" },
    ]);
  });

  it("retries only a failed deadlock chunk with bounded jitter", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    requestSupabaseRestMock
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("deadlock detected code=40P01"))
      .mockResolvedValueOnce(null);
    const { upsertScannerRows } = await import("./scanner-concurrency");

    await upsertScannerRows(
      "wheel_underlying_universe",
      [{ symbol: "AAPL" }, { symbol: "MSFT" }],
      "symbol",
      { chunkSize: 1, random: () => 0.5, sleep },
    );

    expect(requestSupabaseRestMock).toHaveBeenCalledTimes(3);
    expect(requestSupabaseRestMock.mock.calls[0][1].body).toEqual([
      { symbol: "AAPL" },
    ]);
    expect(requestSupabaseRestMock.mock.calls[1][1].body).toEqual([
      { symbol: "MSFT" },
    ]);
    expect(requestSupabaseRestMock.mock.calls[2][1].body).toEqual([
      { symbol: "MSFT" },
    ]);
    expect(sleep).toHaveBeenCalledWith(60);
  });

  it("does not retry non-deadlock failures", async () => {
    requestSupabaseRestMock.mockRejectedValue(
      new Error("permission denied code=42501"),
    );
    const { upsertScannerRows } = await import("./scanner-concurrency");

    await expect(
      upsertScannerRows(
        "wheel_underlying_universe",
        [{ symbol: "AAPL" }],
        "symbol",
      ),
    ).rejects.toThrow("permission denied");
    expect(requestSupabaseRestMock).toHaveBeenCalledOnce();
  });

  it("stops after three deadlock retries", async () => {
    const deadlock = new Error("40P01 deadlock detected");
    const sleep = vi.fn().mockResolvedValue(undefined);
    requestSupabaseRestMock.mockRejectedValue(deadlock);
    const { upsertScannerRows } = await import("./scanner-concurrency");

    await expect(
      upsertScannerRows(
        "wheel_underlying_universe",
        [{ symbol: "AAPL" }],
        "symbol",
        { random: () => 1, sleep },
      ),
    ).rejects.toBe(deadlock);

    expect(requestSupabaseRestMock).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([
      80,
      240,
      560,
    ]);
  });

  it("uses one deterministic lease key per scan context across intervals", async () => {
    requestSupabaseRestMock.mockResolvedValue({
      acquired: true,
      expires_at: "2026-07-23T14:30:00.000Z",
      owner_id: "11111111-1111-1111-1111-111111111111",
      retry_after_seconds: 0,
    });
    const { acquireScannerLease } = await import("./scanner-concurrency");
    const options = {
      context: {
        persona: "balanced_wheel",
        strategy: "short_put",
        filters: { dteMax: 45, dteMin: 21 },
      },
      intervalMinutes: 15,
      now: new Date("2026-07-23T14:17:54.000Z"),
      ownerId: "11111111-1111-1111-1111-111111111111",
      scanKind: "universe" as const,
    };

    const first = await acquireScannerLease(options);
    const second = await acquireScannerLease({
      ...options,
      now: new Date("2026-07-23T14:31:00.000Z"),
    });
    const firstBody = requestSupabaseRestMock.mock.calls[0][1].body;
    const secondBody = requestSupabaseRestMock.mock.calls[1][1].body;

    expect(first).toMatchObject({
      acquired: true,
      intervalStartedAt: "2026-07-23T14:15:00.000Z",
    });
    expect(second).toMatchObject({
      acquired: true,
      intervalStartedAt: "2026-07-23T14:30:00.000Z",
    });
    expect(firstBody.p_lease_key).toBe(secondBody.p_lease_key);
    expect(firstBody.p_context_key).toBe(secondBody.p_context_key);
  });

  it("derives a stable UUID lease owner from a Workflow idempotency key", async () => {
    const { scannerOwnerId } = await import("./scanner-concurrency");

    expect(scannerOwnerId("step_01JZAD017")).toBe(
      scannerOwnerId("step_01JZAD017"),
    );
    expect(scannerOwnerId("step_01JZAD017")).not.toBe(
      scannerOwnerId("step_other"),
    );
    expect(scannerOwnerId("step_01JZAD017")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("surfaces an active owner without treating enqueue as completion", async () => {
    requestSupabaseRestMock.mockResolvedValue({
      acquired: false,
      expires_at: "2026-07-23T14:30:00.000Z",
      owner_id: "22222222-2222-2222-2222-222222222222",
      retry_after_seconds: 42,
    });
    const { acquireScannerLease } = await import("./scanner-concurrency");

    await expect(
      acquireScannerLease({
        context: { persona: "balanced_wheel", strategy: "short_put" },
        intervalMinutes: 15,
        now: new Date("2026-07-23T14:17:54.000Z"),
        ownerId: "11111111-1111-1111-1111-111111111111",
        scanKind: "universe",
      }),
    ).resolves.toEqual({
      acquired: false,
      expiresAt: "2026-07-23T14:30:00.000Z",
      retryAfterSeconds: 42,
    });
  });

  it("renews and releases only the acquired lease owner", async () => {
    requestSupabaseRestMock
      .mockResolvedValueOnce({
        renewed: true,
        expires_at: "2026-07-23T15:30:00.000Z",
      })
      .mockResolvedValueOnce(true);
    const {
      heartbeatScannerLease,
      releaseScannerLease,
    } = await import("./scanner-concurrency");
    const lease = {
      acquired: true as const,
      contextKey: "{}",
      expiresAt: "2026-07-23T14:30:00.000Z",
      intervalStartedAt: "2026-07-23T14:15:00.000Z",
      leaseKey: "universe:interval:digest",
      leaseSeconds: 3600,
      ownerId: "11111111-1111-1111-1111-111111111111",
      scanKind: "universe" as const,
    };

    await expect(heartbeatScannerLease(lease)).resolves.toBe(
      "2026-07-23T15:30:00.000Z",
    );
    await releaseScannerLease(lease);

    expect(requestSupabaseRestMock.mock.calls[0][1].body).toEqual({
      p_lease_key: lease.leaseKey,
      p_lease_seconds: 3600,
      p_owner_id: lease.ownerId,
    });
    expect(requestSupabaseRestMock.mock.calls[1][1].body).toEqual({
      p_lease_key: lease.leaseKey,
      p_owner_id: lease.ownerId,
    });
  });
});
