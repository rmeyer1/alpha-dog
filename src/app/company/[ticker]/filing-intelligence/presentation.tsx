import {
  BookOpen,
  ExternalLink,
  FileText,
  ListChecks,
  Search,
} from "lucide-react";
import type { ReactNode } from "react";
import { formatScoreLabel } from "@/components/wheel-dashboard/formatters";
import { formatCompanyDateTime } from "@/lib/company-date-time";
import type {
  SignalScribeAnalysis,
  SignalScribeFiling,
  SignalScribeSection,
} from "@/lib/company-profile";
import {
  insightFromUnknown,
  sourceLinksForAnalysis,
  type InsightItem,
  type SourceLink,
} from "./normalization";

export function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
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

export function SourceLinks({ sources }: { sources: SourceLink[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-4 min-w-0">
      <div className="text-xs font-medium uppercase text-zinc-500">Sources</div>
      <div className="mt-2 flex min-w-0 flex-wrap gap-2">
        {sources.slice(0, 4).map((source) => (
          <a
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-xs text-cyan-100 hover:border-cyan-200/40 hover:text-cyan-50"
            href={source.url}
            key={`${source.label}-${source.url}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span className="truncate">{source.label}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        ))}
      </div>
    </div>
  );
}

function InlineSourceLinks({ links }: { links: SourceLink[] }) {
  if (links.length === 0) return null;
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1 align-baseline">
      {links.map((link) => (
        <a
          className="inline-flex items-center gap-1 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-1.5 py-0.5 text-xs leading-5 text-cyan-100 hover:border-cyan-200/40 hover:text-cyan-50"
          href={link.url}
          key={`${link.label}-${link.url}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {link.label}
          <ExternalLink className="size-3" />
        </a>
      ))}
    </span>
  );
}

export function InsightContent({ item }: { item: InsightItem }) {
  return (
    <>
      {item.text ? <span>{item.text}</span> : null}
      <InlineSourceLinks links={item.links} />
    </>
  );
}

function insightItems(values: unknown[], limit?: number) {
  return (limit == null ? values : values.slice(0, limit))
    .map(insightFromUnknown)
    .filter((item): item is InsightItem => Boolean(item));
}

export function InsightPreviewList({
  title,
  values,
}: {
  title: string;
  values: unknown[];
}) {
  const displayValues = insightItems(values, 2);
  if (displayValues.length === 0) return null;
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-3">
      <div className="text-xs font-medium uppercase text-zinc-500">{title}</div>
      <ul className="mt-2 grid min-w-0 gap-1.5 text-sm leading-6 text-zinc-300">
        {displayValues.map((value) => (
          <li
            className="min-w-0 break-words [overflow-wrap:anywhere]"
            key={`${value.text}-${value.links.map((link) => link.url).join("|")}`}
          >
            <InsightContent item={value} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ModalList({
  title,
  values,
}: {
  title: string;
  values: unknown[];
}) {
  const displayValues = insightItems(values);
  if (displayValues.length === 0) return null;
  return (
    <section>
      <h3 className="text-xs font-medium uppercase text-zinc-500">{title}</h3>
      <ul className="mt-2 grid gap-2 text-sm leading-6 text-zinc-300">
        {displayValues.map((value, index) => (
          <li
            className="break-words rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 [overflow-wrap:anywhere]"
            key={`${title}-${index}-${value.text}-${value.links.map((link) => link.url).join("|")}`}
          >
            <InsightContent item={value} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReviewButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-white/[0.08]"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function formatNullableScore(value: number | string | null) {
  if (value == null) return "-";
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? formatScoreLabel(numericValue) : "-";
}

export function FilingAnalysisCardList({
  analyses,
  filings,
  onReview,
}: {
  analyses: SignalScribeAnalysis[];
  filings: SignalScribeFiling[];
  onReview: (analysis: SignalScribeAnalysis) => void;
}) {
  const latestAnalysis = analyses[0];
  const priorAnalyses = analyses.slice(1, 3);
  if (!latestAnalysis)
    return <p className="text-sm text-zinc-500">No saved filing analysis.</p>;
  const latestSources = sourceLinksForAnalysis(latestAnalysis, filings);
  return (
    <div className="grid gap-3">
      <article className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StatusPill>{latestAnalysis.form_type}</StatusPill>
            <span className="font-mono text-xs text-zinc-500">
              {latestAnalysis.accession_number}
            </span>
          </div>
          <span className="text-xs text-zinc-500">
            {formatCompanyDateTime(latestAnalysis.created_at)}
          </span>
        </div>
        <p className="mt-3 break-words text-sm leading-6 text-zinc-300 [overflow-wrap:anywhere]">
          {latestAnalysis.summary}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusPill tone="warning">
            Risk {formatNullableScore(latestAnalysis.risk_score)}
          </StatusPill>
          <StatusPill tone="good">
            Quality {formatNullableScore(latestAnalysis.quality_score)}
          </StatusPill>
          {latestAnalysis.management_tone ? (
            <StatusPill>{latestAnalysis.management_tone}</StatusPill>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <InsightPreviewList
            title="Key findings"
            values={latestAnalysis.key_findings}
          />
          <InsightPreviewList
            title="Red flags"
            values={latestAnalysis.red_flags}
          />
        </div>
        <SourceLinks sources={latestSources} />
        <div className="mt-4">
          <ReviewButton onClick={() => onReview(latestAnalysis)}>
            <Search className="size-4" />
            Review full analysis
          </ReviewButton>
        </div>
      </article>
      {priorAnalyses.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {priorAnalyses.map((analysis) => (
            <article
              className="min-w-0 rounded-lg border border-white/10 bg-white/[0.025] p-3"
              key={analysis.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill>{analysis.form_type}</StatusPill>
                <span className="text-xs text-zinc-500">
                  {formatCompanyDateTime(analysis.created_at)}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 break-words text-sm leading-6 text-zinc-400 [overflow-wrap:anywhere]">
                {analysis.summary}
              </p>
              <div className="mt-3">
                <ReviewButton onClick={() => onReview(analysis)}>
                  <FileText className="size-4" />
                  Open analysis
                </ReviewButton>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FilingSectionCardList({
  onReview,
  sections,
}: {
  onReview: (section: SignalScribeSection) => void;
  sections: SignalScribeSection[];
}) {
  if (sections.length === 0)
    return <p className="text-sm text-zinc-500">No saved sections found.</p>;
  return (
    <div className="grid gap-3">
      {sections.slice(0, 4).map((section) => (
        <div
          className="rounded-lg border border-white/10 bg-black/20 p-3"
          key={section.id}
        >
          <div className="flex items-start gap-2">
            <ListChecks className="mt-0.5 size-4 shrink-0 text-amber-200" />
            <div className="min-w-0">
              <div className="break-words font-mono text-xs uppercase text-cyan-100 [overflow-wrap:anywhere]">
                {section.section_name}
              </div>
              <p className="mt-2 line-clamp-2 break-words text-sm leading-6 text-zinc-400 [overflow-wrap:anywhere]">
                {section.section_text}
              </p>
            </div>
          </div>
          <div className="mt-3">
            <ReviewButton onClick={() => onReview(section)}>
              <BookOpen className="size-4" />
              Read section
            </ReviewButton>
          </div>
        </div>
      ))}
    </div>
  );
}
