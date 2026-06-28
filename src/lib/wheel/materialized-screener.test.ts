import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const snapshotRow = {
  id: "11111111-1111-1111-1111-111111111111",
  persona: "balanced_wheel",
  strategy: "short_put",
  filter_key: "{}",
  filters: {},
  feed: "indicative",
  status: "complete",
  started_at: "2026-06-07T13:00:00.000Z",
  completed_at: "2026-06-07T13:03:00.000Z",
  total_count: 4376,
  processed_count: 4376,
  skipped_count: 4000,
  error: null,
  created_at: "2026-06-07T13:00:00.000Z",
};

const candidateRow = {
  snapshot_id: snapshotRow.id,
  persona: "balanced_wheel",
  strategy: "short_put",
  symbol: "AAPL",
  company_name: "Apple Inc.",
  exchange: "NASDAQ",
  score: 94,
  option_type: "put",
  expiration: "2026-06-29",
  dte: 22,
  short_strike: "173.49",
  long_strike: null,
  premium_received: "312.28",
  premium_yield: "0.018",
  annualized_yield: "0.2986",
  return_on_risk: null,
  annualized_return_on_risk: null,
  delta: "-0.28",
  implied_volatility: "0.602",
  liquidity_quality: "excellent",
  warning_count: 0,
  underlying_price: "192.34",
  underlying_as_of: "2026-06-07T13:02:00.000Z",
  trend: "bullish",
  rsi14: "58",
  ma20: "190",
  ma50: "186",
  ma200: "174",
  warnings: [],
  errors: [],
  as_of: "2026-06-07T13:03:00.000Z",
};

function stubSupabaseEnv() {
  vi.stubEnv("USE_DEMO_DATA", "false");
  vi.stubEnv("APCA_API_KEY_ID", "alpaca-key");
  vi.stubEnv("APCA_API_SECRET_KEY", "alpaca-secret");
  vi.stubEnv("ALPACA_OPTIONS_FEED", "indicative");
  vi.stubEnv("ALPHA_DOG_SUPABASE_URL", "https://alpha-dog.supabase.co");
  vi.stubEnv("ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  vi.stubEnv("SIGNAL_SCRIBE_SUPABASE_URL", "https://signal-scribe.supabase.co");
  vi.stubEnv("SIGNAL_SCRIBE_SUPABASE_SERVICE_ROLE_KEY", "signal-key");
}

async function importMaterializedScreener() {
  return await import("./materialized-screener");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.useFakeTimers();
  vi.setSystemTime("2026-06-07T13:04:00.000Z");
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("materialized wheel screener", () => {
  it("does not query Supabase when service-role config is missing", async () => {
    const { getMaterializedWheelScreenerResponse } =
      await importMaterializedScreener();

    await expect(
      getMaterializedWheelScreenerResponse({
        persona: "balanced_wheel",
        strategy: "short_put",
      }),
    ).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps the latest completed Supabase snapshot into a screener response", async () => {
    stubSupabaseEnv();

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify([snapshotRow]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([candidateRow]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      );

    const { getMaterializedWheelScreenerResponse } =
      await importMaterializedScreener();
    const response = await getMaterializedWheelScreenerResponse({
      persona: "balanced_wheel",
      strategy: "short_put",
      limit: 50,
    });

    expect(response).toMatchObject({
      persona: {
        id: "balanced_wheel",
      },
      dataFreshness: {
        ageMinutes: 1,
        feed: "indicative",
        cacheStatus: "fresh",
        asOf: "2026-06-07T13:03:00.000Z",
        lastCompletedAt: "2026-06-07T13:03:00.000Z",
        lastStartedAt: "2026-06-07T13:00:00.000Z",
        refreshStatus: "fresh",
        source: "materialized",
      },
      screenedCount: 4376,
      skippedCount: 4000,
      companies: [
        {
          rank: 1,
          ticker: "AAPL",
          score: 94,
          bestCandidate: {
            strategy: "short_put",
            shortStrike: 173.49,
            premiumReceived: 312.28,
            premiumYield: 0.018,
            delta: -0.28,
          },
        },
      ],
    });

    const snapshotUrl = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    const candidateUrl = new URL(String(vi.mocked(fetch).mock.calls[1][0]));
    expect(snapshotUrl.origin).toBe("https://alpha-dog.supabase.co");
    expect(candidateUrl.pathname).toBe("/rest/v1/wheel_option_candidates");
    expect(candidateUrl.searchParams.get("snapshot_id")).toBe(
      `eq.${snapshotRow.id}`,
    );
    expect(candidateUrl.searchParams.get("strategy")).toBe("eq.short_put");
    expect(candidateUrl.searchParams.get("order")).toBe("score.desc,symbol.asc");
    expect(candidateUrl.searchParams.get("limit")).toBe("200");
    expect(candidateUrl.searchParams.get("offset")).toBe("0");
  });

  it("returns older completed snapshots as stale instead of missing cache", async () => {
    stubSupabaseEnv();

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              ...snapshotRow,
              completed_at: "2026-06-06T10:00:00.000Z",
              created_at: "2026-06-06T09:57:00.000Z",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([candidateRow]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      );

    const { getMaterializedWheelScreenerResponse } =
      await importMaterializedScreener();
    const response = await getMaterializedWheelScreenerResponse({
      persona: "balanced_wheel",
      strategy: "short_put",
      limit: 50,
    });

    expect(response?.dataFreshness.cacheStatus).toBe("stale");
    expect(response?.dataFreshness.ageMinutes).toBe(1624);
    expect(response?.dataFreshness.refreshStatus).toBe("stale");
    expect(response?.dataFreshness.source).toBe("materialized");
    expect(response?.companies[0].ticker).toBe("AAPL");
  });

  it("reports materialized refresh status for running snapshots", async () => {
    stubSupabaseEnv();

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            ...snapshotRow,
            id: "22222222-2222-2222-2222-222222222222",
            status: "running",
            started_at: "2026-06-07T13:04:00.000Z",
            completed_at: null,
            created_at: "2026-06-07T13:04:00.000Z",
          },
          snapshotRow,
        ]),
        { status: 200 },
      ),
    );

    const { getMaterializedWheelScreenerRefreshStatus } =
      await importMaterializedScreener();
    const status = await getMaterializedWheelScreenerRefreshStatus({
      persona: "balanced_wheel",
      strategy: "short_put",
    });
    const statusUrl = new URL(String(vi.mocked(fetch).mock.calls[0][0]));

    expect(statusUrl.searchParams.get("status")).toBe(
      "in.(running,complete,failed)",
    );
    expect(status).toMatchObject({
      ageMinutes: 1,
      cacheStatus: "fresh",
      lastCompletedAt: "2026-06-07T13:03:00.000Z",
      lastStartedAt: "2026-06-07T13:04:00.000Z",
      refreshStatus: "refreshing",
      source: "materialized",
    });
  });

  it("reports failed materialized refresh status without a completed snapshot", async () => {
    stubSupabaseEnv();

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            ...snapshotRow,
            status: "failed",
            completed_at: "2026-06-07T13:02:00.000Z",
            created_at: "2026-06-07T13:00:00.000Z",
            error: "Alpaca rate limit",
          },
        ]),
        { status: 200 },
      ),
    );

    const { getMaterializedWheelScreenerRefreshStatus } =
      await importMaterializedScreener();
    const status = await getMaterializedWheelScreenerRefreshStatus({
      persona: "balanced_wheel",
      strategy: "short_put",
    });

    expect(status).toMatchObject({
      ageMinutes: 2,
      cacheStatus: null,
      error: "Alpaca rate limit",
      lastCompletedAt: null,
      lastFailedAt: "2026-06-07T13:02:00.000Z",
      refreshStatus: "failed",
    });
  });

  it("supports offset reads from materialized candidate rows", async () => {
    stubSupabaseEnv();

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify([snapshotRow]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([candidateRow]), { status: 200 }),
      );

    const { getMaterializedWheelScreenerResponse } =
      await importMaterializedScreener();
    const response = await getMaterializedWheelScreenerResponse({
      persona: "balanced_wheel",
      strategy: "short_put",
      limit: 50,
      cursor: 50,
    });
    const candidateUrl = new URL(String(vi.mocked(fetch).mock.calls[1][0]));

    expect(candidateUrl.searchParams.get("offset")).toBe("50");
    expect(response?.companies[0].rank).toBe(51);
    expect(response?.progress.cursor).toBe(50);
  });

  it("falls back to legacy candidate reads before premium column migration", async () => {
    stubSupabaseEnv();

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify([snapshotRow]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: "column wheel_option_candidates.premium_received does not exist",
            code: "42703",
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              ...candidateRow,
              premium_received: undefined,
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const { getMaterializedWheelScreenerResponse } =
      await importMaterializedScreener();
    const response = await getMaterializedWheelScreenerResponse({
      persona: "balanced_wheel",
      strategy: "short_put",
      limit: 50,
    });
    const retryUrl = new URL(String(vi.mocked(fetch).mock.calls[2][0]));

    expect(retryUrl.searchParams.get("select")).not.toContain(
      "premium_received",
    );
    expect(response?.companies[0].bestCandidate.premiumReceived).toBe(312.28);
  });

  it("normalizes unknown liquidity from existing materialized rows", async () => {
    stubSupabaseEnv();

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify([snapshotRow]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              ...candidateRow,
              liquidity_quality: "unknown",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      );

    const { getMaterializedWheelScreenerResponse } =
      await importMaterializedScreener();
    const response = await getMaterializedWheelScreenerResponse({
      persona: "balanced_wheel",
      strategy: "short_put",
      limit: 50,
    });

    expect(response?.companies[0].bestCandidate.liquidityQuality).toBe("weak");
  });

  it("merges recent background deep-scan candidates into the first page", async () => {
    stubSupabaseEnv();

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify([snapshotRow]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([candidateRow]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              ...candidateRow,
              symbol: "MSFT",
              company_name: "Microsoft Corporation",
              score: 99,
            },
          ]),
          { status: 200 },
        ),
      );

    const { getMaterializedWheelScreenerResponse } =
      await importMaterializedScreener();
    const response = await getMaterializedWheelScreenerResponse({
      persona: "balanced_wheel",
      strategy: "short_put",
      limit: 50,
    });
    const deepCandidateUrl = new URL(String(vi.mocked(fetch).mock.calls[2][0]));

    expect(deepCandidateUrl.pathname).toBe(
      "/rest/v1/wheel_deep_scan_candidates",
    );
    expect(deepCandidateUrl.searchParams.get("filter_key")).toContain(
      '"dteMin":21',
    );
    expect(response?.companies.map((company) => company.ticker)).toEqual([
      "MSFT",
      "AAPL",
    ]);
  });

  it("writes snapshot metadata and candidate rows through service-role REST", async () => {
    stubSupabaseEnv();

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: snapshotRow.id }]), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const {
      createMaterializedWheelScreenerSnapshot,
      upsertMaterializedWheelScreenerCandidates,
      completeMaterializedWheelScreenerSnapshot,
    } = await importMaterializedScreener();
    const request = {
      persona: "balanced_wheel" as const,
      strategy: "short_put" as const,
      limit: 50,
    };
    const snapshotId = await createMaterializedWheelScreenerSnapshot(request);

    expect(snapshotId).toBe(snapshotRow.id);

    await upsertMaterializedWheelScreenerCandidates(snapshotId, request, {
      persona: {
        id: "balanced_wheel",
        name: "Balanced Wheel",
        motto: "Income with discipline.",
      },
      dataFreshness: {
        feed: "indicative",
        cacheStatus: "fresh",
        asOf: "2026-06-07T13:03:00.000Z",
        nextSuggestedRefreshAt: null,
      },
      companies: [
        {
          rank: 1,
          ticker: "AAPL",
          name: "Apple Inc.",
          exchange: "NASDAQ",
          score: 94,
          underlying: {
            symbol: "AAPL",
            price: 192.34,
            asOf: "2026-06-07T13:02:00.000Z",
            trend: "bullish",
            rsi14: 58,
            movingAverages: {
              ma20: 190,
              ma50: 186,
              ma200: 174,
            },
          },
          bestCandidate: {
            strategy: "short_put",
            score: 94,
            expirationDate: "2026-06-29",
            dte: 22,
            shortStrike: 173.49,
            premiumReceived: 312.28,
            premiumYield: 0.018,
            annualizedYield: 0.2986,
            delta: -0.28,
            impliedVolatility: 0.602,
            liquidityQuality: "excellent",
            warningCount: 0,
          },
          warnings: [],
          errors: [],
        },
      ],
      screenedCount: 4376,
      skippedCount: 4000,
      progress: {
        status: "complete",
        resultScope: "complete",
        cursor: 0,
        nextCursor: null,
        batchSize: 32,
        batchScreenedCount: 32,
        processedCount: 4376,
        totalCount: 4376,
      },
      warnings: [],
      errors: [],
    });
    await completeMaterializedWheelScreenerSnapshot(snapshotId, {
      companies: [],
      screenedCount: 4376,
      skippedCount: 4000,
      progress: {
        status: "complete",
        resultScope: "complete",
        cursor: 0,
        nextCursor: null,
        batchSize: 32,
        batchScreenedCount: 32,
        processedCount: 4376,
        totalCount: 4376,
      },
      warnings: [],
      errors: [],
    } as never);

    const createCall = vi.mocked(fetch).mock.calls[0];
    const upsertCall = vi.mocked(fetch).mock.calls[1];
    const completeCall = vi.mocked(fetch).mock.calls[2];

    expect(createCall[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        apikey: "service-role-key",
        Authorization: "Bearer service-role-key",
        Prefer: "return=representation",
      }),
    });
    expect(JSON.parse(String(upsertCall[1]?.body))).toMatchObject([
      {
        snapshot_id: snapshotRow.id,
        strategy: "short_put",
        option_type: "put",
        symbol: "AAPL",
        premium_received: 312.28,
      },
    ]);
    expect(new URL(String(upsertCall[0])).searchParams.get("on_conflict")).toBe(
      "snapshot_id,symbol,strategy",
    );
    expect(completeCall[1]).toMatchObject({
      method: "PATCH",
      headers: expect.objectContaining({
        Prefer: "return=minimal",
      }),
    });
  });
});
