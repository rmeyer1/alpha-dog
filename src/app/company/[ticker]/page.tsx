import {
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarDays,
  ExternalLink,
  FileText,
  Gauge,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { CompanyLogo } from "@/components/company-logo";
import {
  getCompanyProfile,
  type AlpacaBar,
  type SignalScribeFinancialFact,
  type SignalScribeProfile,
} from "@/lib/company-profile";
import {
  FilingAnalysisCards,
  FilingSectionCards,
} from "./filing-intelligence";
import {
  formatCompactNumber,
  formatCurrency,
  formatPercent,
} from "@/components/wheel-dashboard/formatters";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker } = await params;
  const normalizedTicker = ticker.toUpperCase();

  return {
    title: `${normalizedTicker} Company Profile | Alpha Dog`,
  };
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMetricValue(value: number | string | null, unit: string | null) {
  if (value == null) {
    return "-";
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return String(value);
  }

  if (unit === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: Math.abs(numericValue) >= 1_000_000 ? "compact" : "standard",
      maximumFractionDigits: 2,
    }).format(numericValue);
  }

  return `${new Intl.NumberFormat("en-US", {
    notation: Math.abs(numericValue) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(numericValue)}${unit && unit !== "pure" ? ` ${unit}` : ""}`;
}

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "good" | "warning" | "neutral";
}) {
  const classes = {
    good: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100",
    warning: "border-amber-300/30 bg-amber-400/10 text-amber-100",
    neutral: "border-white/10 bg-white/[0.05] text-zinc-200",
  };

  return (
    <span className={`rounded-md border px-2 py-1 text-xs ${classes[tone]}`}>
      {children}
    </span>
  );
}

function MetricTile({
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

function Sparkline({ bars }: { bars: AlpacaBar[] }) {
  const chartBars = bars.slice(-90);
  const closes = chartBars.map((bar) => bar.c);

  if (closes.length < 2) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-sm text-zinc-500">
        No historical bars available
      </div>
    );
  }

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const paddedMin = min - (max - min) * 0.08;
  const paddedMax = max + (max - min) * 0.08;
  const range = paddedMax - paddedMin || 1;
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const value = paddedMax - range * ratio;

    return {
      ratio,
      value,
    };
  });
  const xTickIndexes = Array.from(
    new Set([
      0,
      Math.floor((chartBars.length - 1) / 2),
      chartBars.length - 1,
    ]),
  );
  const points = closes
    .map((close, index) => {
      const x = (index / (closes.length - 1)) * 100;
      const y = 100 - ((close - paddedMin) / range) * 100;

      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="mb-2 grid grid-cols-[58px_minmax(0,1fr)] text-xs uppercase text-zinc-500">
        <span>Price</span>
        <span className="text-right">90 sessions</span>
      </div>
      <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-2">
        <div className="relative h-56 font-mono text-[11px] text-zinc-400">
          {yTicks.map((tick) => (
            <span
              className="absolute right-0 -translate-y-1/2"
              key={tick.value}
              style={{ top: `${tick.ratio * 100}%` }}
            >
              {formatCurrency(tick.value)}
            </span>
          ))}
        </div>
        <div className="h-56 rounded-md bg-[#111314]">
          <svg
            aria-label="90 session price history with price and date axes"
            className="h-full w-full overflow-visible"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            {[0, 25, 50, 75, 100].map((tick) => (
              <line
                key={`y-${tick}`}
                stroke="rgba(255,255,255,0.08)"
                vectorEffect="non-scaling-stroke"
                x1="0"
                x2="100"
                y1={tick}
                y2={tick}
              />
            ))}
            {[0, 50, 100].map((tick) => (
              <line
                key={`x-${tick}`}
                stroke="rgba(255,255,255,0.08)"
                vectorEffect="non-scaling-stroke"
                x1={tick}
                x2={tick}
                y1="0"
                y2="100"
              />
            ))}
            <line
              stroke="rgba(255,255,255,0.24)"
              vectorEffect="non-scaling-stroke"
              x1="0"
              x2="0"
              y1="0"
              y2="100"
            />
            <line
              stroke="rgba(255,255,255,0.24)"
              vectorEffect="non-scaling-stroke"
              x1="0"
              x2="100"
              y1="100"
              y2="100"
            />
            <polyline
              fill="none"
              points={points}
              stroke="#67e8f9"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-[58px_minmax(0,1fr)] gap-2">
        <span />
        <div className="flex justify-between gap-3 font-mono text-[11px] text-zinc-400">
          {xTickIndexes.map((index) => (
            <span
              className={
                index === 0
                  ? "text-left"
                  : index === chartBars.length - 1
                    ? "text-right"
                    : "text-center"
              }
              key={chartBars[index].t}
            >
              {formatDate(chartBars[index].t)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-1 grid grid-cols-[58px_minmax(0,1fr)] gap-2 text-xs text-zinc-300">
        <span />
        <span className="text-center">Date</span>
      </div>
    </div>
  );
}

function SectionShell({
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

function FilingTable({ signalScribe }: { signalScribe: SignalScribeProfile }) {
  if (signalScribe.filings.length === 0) {
    return <p className="text-sm text-zinc-500">No filings found.</p>;
  }

  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-white/10 text-xs uppercase text-zinc-500">
          <tr>
            <th className="py-2 pr-3">Form</th>
            <th className="py-2 pr-3">Filed</th>
            <th className="py-2 pr-3">Report</th>
            <th className="py-2 pr-3">Period</th>
            <th className="py-2 pr-3">Accession</th>
            <th className="py-2">SEC</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10 text-zinc-300">
          {signalScribe.filings.slice(0, 8).map((filing) => (
            <tr key={filing.id}>
              <td className="py-3 pr-3">
                <StatusPill>{filing.form_type}</StatusPill>
              </td>
              <td className="py-3 pr-3">{formatDate(filing.filing_date)}</td>
              <td className="py-3 pr-3">{formatDate(filing.report_date)}</td>
              <td className="py-3 pr-3">
                {[filing.fiscal_year, filing.fiscal_period]
                  .filter(Boolean)
                  .join(" ") || "-"}
              </td>
              <td className="py-3 pr-3 font-mono text-xs text-zinc-400">
                {filing.accession_number}
              </td>
              <td className="py-3">
                {filing.sec_url ? (
                  <a
                    className="inline-flex items-center gap-1 text-cyan-100 hover:text-cyan-50"
                    href={filing.sec_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open <ExternalLink className="size-3.5" />
                  </a>
                ) : (
                  "-"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FinancialFactGrid({
  facts,
}: {
  facts: SignalScribeFinancialFact[];
}) {
  const latestByMetric = new Map<string, SignalScribeFinancialFact>();

  for (const fact of facts) {
    if (!latestByMetric.has(fact.metric_name)) {
      latestByMetric.set(fact.metric_name, fact);
    }
  }

  const rows = Array.from(latestByMetric.values()).slice(0, 12);

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">No financial facts found.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((fact) => (
        <div
          className="rounded-lg border border-white/10 bg-black/20 p-4"
          key={fact.id}
        >
          <div className="min-h-10 text-sm font-medium text-zinc-200">
            {fact.metric_name}
          </div>
          <div className="mt-2 font-mono text-xl font-semibold text-white">
            {formatMetricValue(fact.value, fact.unit)}
          </div>
          <div className="mt-2 text-xs text-zinc-500">
            {[fact.fiscal_year, fact.fiscal_period].filter(Boolean).join(" ") ||
              "latest"}
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function CompanyProfilePage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: tickerParam } = await params;
  const profile = await getCompanyProfile(tickerParam);
  const { market, signalScribe, ticker } = profile;
  const stats = market.stats;
  const companyName =
    signalScribe.company?.company_name ?? market.asset?.name ?? ticker;
  const latestQuote = market.snapshot?.latestQuote;
  const dailyBar = market.snapshot?.dailyBar ?? market.bars.at(-1);
  const spread =
    latestQuote?.ap == null || latestQuote.bp == null
      ? null
      : latestQuote.ap - latestQuote.bp;

  return (
    <main className="min-h-screen bg-[#0b0c0d] text-zinc-100">
      <div className="mx-auto grid max-w-[1600px] gap-5 px-4 py-5 md:px-6 xl:px-8">
        <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link
              className="mb-4 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"
              href="/"
            >
              <ArrowLeft className="size-4" />
              Dashboard
            </Link>
            <div className="flex items-center gap-4">
              <CompanyLogo name={companyName} size="lg" symbol={ticker} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                  <h1 className="font-mono text-5xl font-semibold text-white">
                    {ticker}
                  </h1>
                  <span className="pb-1 text-2xl text-zinc-300">
                    {companyName}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill
                tone={market.status === "available" ? "good" : "warning"}
              >
                Alpaca {market.status.replace("_", " ")}
              </StatusPill>
              <StatusPill
                tone={
                  signalScribe.status === "available" ? "good" : "warning"
                }
              >
                SEC intelligence {signalScribe.status.replace("_", " ")}
              </StatusPill>
              {market.asset?.exchange ? (
                <StatusPill>{market.asset.exchange}</StatusPill>
              ) : null}
              {signalScribe.company?.cik ? (
                <StatusPill>CIK {signalScribe.company.cik}</StatusPill>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#151718] p-4 lg:min-w-80">
            <div className="text-xs uppercase text-zinc-500">Latest price</div>
            <div className="mt-2 flex items-end gap-3">
              <span className="font-mono text-4xl font-semibold text-white">
                {formatCurrency(stats?.price)}
              </span>
              <span
                className={`pb-1 font-mono text-sm ${
                  (stats?.change ?? 0) >= 0 ? "text-emerald-200" : "text-red-200"
                }`}
              >
                {stats?.change == null
                  ? "-"
                  : `${stats.change >= 0 ? "+" : ""}${formatCurrency(stats.change)}`}{" "}
                {stats?.changePercent == null
                  ? ""
                  : `(${formatPercent(stats.changePercent)})`}
              </span>
            </div>
            <div className="mt-2 text-xs text-zinc-500">
              As of {formatDateTime(market.asOf)}
            </div>
          </div>
        </div>

        {market.message || signalScribe.message ? (
          <div className="grid gap-3">
            {market.message ? (
              <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-3 text-sm text-amber-100">
                {market.message}
              </div>
            ) : null}
            {signalScribe.message ? (
              <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-3 text-sm text-amber-100">
                {signalScribe.message}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid min-w-0 content-start gap-5">
            <SectionShell
              icon={<TrendingUp className="size-4 text-cyan-200" />}
              title="Market Snapshot"
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricTile label="1 week" value={formatPercent(stats?.weekReturn)} />
                <MetricTile label="1 month" value={formatPercent(stats?.monthReturn)} />
                <MetricTile
                  label="3 month"
                  value={formatPercent(stats?.threeMonthReturn)}
                />
                <MetricTile label="1 year" value={formatPercent(stats?.yearReturn)} />
                <MetricTile label="52w high" value={formatCurrency(stats?.high52Week)} />
                <MetricTile label="52w low" value={formatCurrency(stats?.low52Week)} />
                <MetricTile
                  label="20d avg volume"
                  value={formatCompactNumber(stats?.averageVolume20Day)}
                />
                <MetricTile
                  label="volume / avg"
                  value={stats?.volumeVsAverage20Day == null ? "-" : `${stats.volumeVsAverage20Day}x`}
                />
              </div>
              <div className="mt-4">
                <Sparkline bars={market.bars} />
              </div>
            </SectionShell>

            <SectionShell
              icon={<FileText className="size-4 text-cyan-200" />}
              title="SEC Filing Analysis"
            >
              <FilingAnalysisCards
                analyses={signalScribe.analyses}
                filings={signalScribe.filings}
              />
            </SectionShell>

            <SectionShell
              icon={<CalendarDays className="size-4 text-cyan-200" />}
              title="Recent Filings"
            >
              <FilingTable signalScribe={signalScribe} />
            </SectionShell>

            <SectionShell
              icon={<BarChart3 className="size-4 text-cyan-200" />}
              title="Financial Facts"
            >
              <FinancialFactGrid facts={signalScribe.financialFacts} />
            </SectionShell>
          </div>

          <aside className="grid content-start gap-5">
            <SectionShell
              icon={<Building2 className="size-4 text-emerald-200" />}
              title="Company"
            >
              <div className="grid gap-3 text-sm">
                <InfoRow label="Name" value={companyName} />
                <InfoRow
                  label="Sector"
                  value={signalScribe.company?.sector ?? "-"}
                />
                <InfoRow
                  label="Industry"
                  value={signalScribe.company?.industry ?? "-"}
                />
                <InfoRow label="SIC" value={signalScribe.company?.sic ?? "-"} />
                <InfoRow
                  label="Tradable"
                  value={market.asset?.tradable == null ? "-" : market.asset.tradable ? "Yes" : "No"}
                />
                <InfoRow
                  label="Shortable"
                  value={market.asset?.shortable == null ? "-" : market.asset.shortable ? "Yes" : "No"}
                />
                <InfoRow
                  label="Fractional"
                  value={market.asset?.fractionable == null ? "-" : market.asset.fractionable ? "Yes" : "No"}
                />
              </div>
            </SectionShell>

            <SectionShell
              icon={<Gauge className="size-4 text-emerald-200" />}
              title="Trading Snapshot"
            >
              <div className="grid gap-3">
                <MetricTile label="Open" value={formatCurrency(dailyBar?.o)} />
                <MetricTile label="High" value={formatCurrency(dailyBar?.h)} />
                <MetricTile label="Low" value={formatCurrency(dailyBar?.l)} />
                <MetricTile
                  label="Day volume"
                  value={formatCompactNumber(dailyBar?.v)}
                />
                <MetricTile label="Bid" value={formatCurrency(latestQuote?.bp)} />
                <MetricTile label="Ask" value={formatCurrency(latestQuote?.ap)} />
                <MetricTile label="Spread" value={formatCurrency(spread)} />
                <MetricTile
                  label="Trade size"
                  value={formatCompactNumber(market.snapshot?.latestTrade?.s)}
                />
              </div>
            </SectionShell>

            <SectionShell
              icon={<ShieldAlert className="size-4 text-amber-200" />}
              title="Filing Sections"
            >
              <FilingSectionCards sections={signalScribe.sections} />
            </SectionShell>
          </aside>
        </div>
      </div>
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-2 last:border-b-0 last:pb-0">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right text-zinc-200">{value}</span>
    </div>
  );
}
