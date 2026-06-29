import {
  BarChart3,
  Building2,
  ExternalLink,
  Newspaper,
  PieChart,
  Sparkles,
} from "lucide-react";
import type {
  FinnhubCompanyInsights,
  FinnhubCompanyNewsItem,
  FinnhubEarningsSurprise,
  FinnhubRecommendationTrend,
} from "@/lib/finnhub/client";
import {
  formatCompactNumber,
  formatCurrency,
} from "@/components/wheel-dashboard/formatters";

type CompanyInsightStatus = "idle" | "loading" | "success" | "error";

export interface CompanyInsightState {
  data: FinnhubCompanyInsights | null;
  error: string | null;
  status: CompanyInsightStatus;
}

const emptyState: CompanyInsightState = {
  data: null,
  error: null,
  status: "idle",
};

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metricNumber(insights: FinnhubCompanyInsights | null, key: string) {
  return insights ? asNumber(insights.metrics.metric[key]) : null;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatNewsDate(value: number | null | undefined) {
  if (value == null) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value * 1000));
}

function formatSignedPercent(value: number | null | undefined) {
  if (value == null) {
    return "-";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatMetricPercent(value: number | null | undefined) {
  if (value == null) {
    return "-";
  }

  return `${value.toFixed(1)}%`;
}

function formatMarketCapFromMillions(value: number | null | undefined) {
  if (value == null) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 1,
    notation: "compact",
    style: "currency",
  }).format(value * 1_000_000);
}

function latestEarnings(insights: FinnhubCompanyInsights | null) {
  return insights?.earningsSurprises[0] ?? null;
}

function latestRecommendation(insights: FinnhubCompanyInsights | null) {
  return insights?.recommendations[0] ?? null;
}

function recommendationTotals(recommendation: FinnhubRecommendationTrend | null) {
  const strongBuy = recommendation?.strongBuy ?? 0;
  const buy = recommendation?.buy ?? 0;
  const hold = recommendation?.hold ?? 0;
  const sell = recommendation?.sell ?? 0;
  const strongSell = recommendation?.strongSell ?? 0;

  return {
    bullish: strongBuy + buy,
    cautious: sell + strongSell,
    hold,
    total: strongBuy + buy + hold + sell + strongSell,
  };
}

function recommendationLabel(recommendation: FinnhubRecommendationTrend | null) {
  const totals = recommendationTotals(recommendation);

  if (totals.total === 0) {
    return "No analyst trend";
  }

  if (totals.bullish > totals.hold && totals.bullish > totals.cautious) {
    return `${totals.bullish} bullish`;
  }

  if (totals.cautious > totals.hold && totals.cautious > totals.bullish) {
    return `${totals.cautious} cautious`;
  }

  return `${totals.hold} hold`;
}

function earningsLabel(earnings: FinnhubEarningsSurprise | null) {
  if (!earnings) {
    return "No recent EPS data";
  }

  if (earnings.surprisePercent == null) {
    return "EPS reported";
  }

  return `${earnings.surprisePercent >= 0 ? "Beat" : "Miss"} ${formatSignedPercent(
    earnings.surprisePercent,
  )}`;
}

function latestHeadline(insights: FinnhubCompanyInsights | null) {
  return insights?.news[0] ?? null;
}

function InsightShell({
  children,
  icon,
  title,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-white/10 bg-[#151718] p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function InsightMetric({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="text-xs uppercase text-zinc-500">{label}</div>
      <div className="mt-2 font-mono text-lg font-semibold text-white">
        {value}
      </div>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-amber-300/20 bg-amber-400/10 p-3 text-sm text-amber-100">
      {message}
    </div>
  );
}

function LoadingTiles() {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {["Earnings", "Headlines", "Fundamentals", "Analysts"].map((label) => (
        <div
          className="min-h-28 animate-pulse rounded-lg border border-white/10 bg-white/[0.035] p-4"
          key={label}
        >
          <div className="text-xs uppercase text-zinc-600">{label}</div>
          <div className="mt-4 h-5 w-24 rounded bg-white/10" />
          <div className="mt-3 h-3 w-32 rounded bg-white/5" />
        </div>
      ))}
    </div>
  );
}

export function CompanyInsightStrip({
  state = emptyState,
}: {
  state?: CompanyInsightState;
}) {
  const { data, error, status } = state;
  const earnings = latestEarnings(data);
  const headline = latestHeadline(data);
  const recommendation = latestRecommendation(data);
  const pe = metricNumber(data, "peNormalizedAnnual");
  const marketCap = data?.profile.marketCapitalization ??
    metricNumber(data, "marketCapitalization");

  return (
    <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Sparkles className="size-4 text-cyan-200" />
          Company Context
        </div>
        {data?.errors.length ? (
          <span className="text-xs text-amber-100">
            {data.errors.length} Finnhub section unavailable
          </span>
        ) : null}
      </div>

      {status === "loading" ? <LoadingTiles /> : null}
      {status === "error" ? (
        <ErrorNote message={error ?? "Company context is unavailable."} />
      ) : null}
      {status === "success" && data ? (
        <div className="grid gap-3 md:grid-cols-4">
          <InsightMetric
            label="Earnings"
            value={
              <span
                className={
                  (earnings?.surprisePercent ?? 0) < 0
                    ? "text-amber-100"
                    : "text-emerald-100"
                }
              >
                {earningsLabel(earnings)}
              </span>
            }
          />
          <InsightMetric
            label="Headlines"
            value={
              <span className={data.news.length > 8 ? "text-amber-100" : ""}>
                {data.news.length} recent
              </span>
            }
          />
          <InsightMetric
            label="Valuation"
            value={pe == null ? formatMarketCapFromMillions(marketCap) : `${pe.toFixed(1)} PE`}
          />
          <InsightMetric
            label="Analysts"
            value={recommendationLabel(recommendation)}
          />
          <div className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-4 md:col-span-4">
            <div className="text-xs uppercase text-zinc-500">Latest headline</div>
            <div className="mt-2 min-w-0 text-sm text-zinc-200">
              {headline ? (
                <a
                  className="line-clamp-2 hover:text-cyan-100"
                  href={headline.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {headline.headline}
                </a>
              ) : (
                <span className="text-zinc-500">No headlines in the selected window.</span>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function EarningsBehavior({
  earnings,
}: {
  earnings: FinnhubEarningsSurprise[];
}) {
  if (earnings.length === 0) {
    return <p className="text-sm text-zinc-500">No recent EPS surprise data.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {earnings.slice(0, 4).map((row) => {
        const tone = (row.surprisePercent ?? 0) >= 0
          ? "text-emerald-100"
          : "text-amber-100";

        return (
          <div
            className="rounded-lg border border-white/10 bg-black/20 p-4"
            key={`${row.period}-${row.quarter}`}
          >
            <div className="text-xs uppercase text-zinc-500">
              {row.year && row.quarter ? `Q${row.quarter} ${row.year}` : formatDate(row.period)}
            </div>
            <div className={`mt-2 font-mono text-xl font-semibold ${tone}`}>
              {formatSignedPercent(row.surprisePercent)}
            </div>
            <div className="mt-2 text-xs text-zinc-400">
              Actual {row.actual ?? "-"} / Est. {row.estimate ?? "-"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecommendationBar({
  recommendation,
}: {
  recommendation: FinnhubRecommendationTrend | null;
}) {
  const totals = recommendationTotals(recommendation);

  if (totals.total === 0) {
    return <p className="text-sm text-zinc-500">No recommendation trend found.</p>;
  }

  const bullish = (totals.bullish / totals.total) * 100;
  const hold = (totals.hold / totals.total) * 100;
  const cautious = Math.max(0, 100 - bullish - hold);

  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-white/10">
        <div className="bg-emerald-300" style={{ width: `${bullish}%` }} />
        <div className="bg-zinc-400" style={{ width: `${hold}%` }} />
        <div className="bg-amber-300" style={{ width: `${cautious}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-zinc-300">
        <span>Bullish {totals.bullish}</span>
        <span>Hold {totals.hold}</span>
        <span>Cautious {totals.cautious}</span>
      </div>
      <div className="mt-3 text-xs text-zinc-500">
        Period {recommendation?.period ?? "latest"}
      </div>
    </div>
  );
}

function NewsList({ news }: { news: FinnhubCompanyNewsItem[] }) {
  if (news.length === 0) {
    return <p className="text-sm text-zinc-500">No recent company headlines.</p>;
  }

  return (
    <div className="grid gap-3">
      {news.slice(0, 5).map((item) => (
        <a
          className="block rounded-lg border border-white/10 bg-black/20 p-4 transition hover:border-cyan-300/30 hover:bg-cyan-400/[0.04]"
          href={item.url}
          key={item.id ?? item.url}
          rel="noreferrer"
          target="_blank"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span>{item.source ?? "Finnhub"}</span>
            <span>{formatNewsDate(item.datetime)}</span>
          </div>
          <div className="mt-2 text-sm font-medium text-zinc-100">
            {item.headline}
          </div>
          {item.summary ? (
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-400">
              {item.summary}
            </p>
          ) : null}
        </a>
      ))}
    </div>
  );
}

export function CompanyInsightSections({
  insights,
}: {
  insights: FinnhubCompanyInsights | null;
}) {
  if (!insights) {
    return (
      <InsightShell
        icon={<Sparkles className="size-4 text-cyan-200" />}
        title="Finnhub Insights"
      >
        <p className="text-sm text-zinc-500">Company insights are unavailable.</p>
      </InsightShell>
    );
  }

  const metric = (key: string) => metricNumber(insights, key);
  const latest = latestRecommendation(insights);

  return (
    <>
      {insights.errors.length ? (
        <ErrorNote
          message={`${insights.errors.length} Finnhub section${
            insights.errors.length === 1 ? "" : "s"
          } unavailable. Showing the sections that loaded.`}
        />
      ) : null}
      <InsightShell
        icon={<BarChart3 className="size-4 text-cyan-200" />}
        title="Earnings Behavior"
      >
        <EarningsBehavior earnings={insights.earningsSurprises} />
      </InsightShell>
      <InsightShell
        icon={<Newspaper className="size-4 text-cyan-200" />}
        title="Recent Headlines"
      >
        <NewsList news={insights.news} />
      </InsightShell>
      <InsightShell
        icon={<PieChart className="size-4 text-cyan-200" />}
        title="Fundamental Snapshot"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <InsightMetric
            label="Market cap"
            value={formatMarketCapFromMillions(
              insights.profile.marketCapitalization ?? metric("marketCapitalization"),
            )}
          />
          <InsightMetric
            label="PE normalized"
            value={metric("peNormalizedAnnual")?.toFixed(1) ?? "-"}
          />
          <InsightMetric
            label="52w high"
            value={formatCurrency(metric("52WeekHigh"))}
          />
          <InsightMetric
            label="52w low"
            value={formatCurrency(metric("52WeekLow"))}
          />
          <InsightMetric
            label="Beta"
            value={metric("beta")?.toFixed(2) ?? "-"}
          />
          <InsightMetric
            label="Revenue growth"
            value={formatMetricPercent(metric("revenueGrowthTTMYoy"))}
          />
          <InsightMetric
            label="Gross margin"
            value={formatMetricPercent(metric("grossMarginTTM"))}
          />
          <InsightMetric
            label="Shares"
            value={formatCompactNumber(insights.profile.shareOutstanding)}
          />
        </div>
      </InsightShell>
      <InsightShell
        icon={<Building2 className="size-4 text-emerald-200" />}
        title="Analyst Trend"
      >
        <RecommendationBar recommendation={latest} />
      </InsightShell>
    </>
  );
}

export function CompanyContextPanel({
  insights,
  status = "idle",
}: {
  insights: FinnhubCompanyInsights | null;
  status?: CompanyInsightStatus;
}) {
  const earnings = latestEarnings(insights);
  const headline = latestHeadline(insights);
  const recommendation = latestRecommendation(insights);
  const pe = metricNumber(insights, "peNormalizedAnnual");
  const high = metricNumber(insights, "52WeekHigh");
  const low = metricNumber(insights, "52WeekLow");

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
        <Sparkles className="size-4 text-cyan-200" />
        Company context
      </div>
      {status === "loading" ? (
        <div className="text-sm text-zinc-500">Loading company context...</div>
      ) : null}
      {status !== "loading" && !insights ? (
        <div className="text-sm text-zinc-500">Company context unavailable.</div>
      ) : null}
      {insights ? (
        <div className="grid gap-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-zinc-500">Earnings</div>
              <div className="font-mono text-zinc-100">{earningsLabel(earnings)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Analysts</div>
              <div className="font-mono text-zinc-100">
                {recommendationLabel(recommendation)}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">PE</div>
              <div className="font-mono text-zinc-100">
                {pe == null ? "-" : pe.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">52w range</div>
              <div className="font-mono text-zinc-100">
                {formatCurrency(low)} - {formatCurrency(high)}
              </div>
            </div>
          </div>
          {headline ? (
            <a
              className="flex items-start gap-2 rounded-md border border-white/10 bg-white/[0.035] p-3 text-zinc-200 hover:border-cyan-300/30 hover:text-cyan-100"
              href={headline.url}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
              <span className="line-clamp-2">{headline.headline}</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
