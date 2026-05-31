"use client";

import {
  BookOpen,
  ExternalLink,
  FileText,
  ListChecks,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatScoreLabel } from "@/components/wheel-dashboard/formatters";
import type {
  SignalScribeAnalysis,
  SignalScribeFiling,
  SignalScribeSection,
} from "@/lib/company-profile";

interface SourceLink {
  label: string;
  url: string;
}

type ModalState =
  | { kind: "analysis"; analysis: SignalScribeAnalysis }
  | { kind: "section"; section: SignalScribeSection }
  | null;

const citationUrlKeys = [
  "url",
  "href",
  "link",
  "sourceUrl",
  "source_url",
  "secUrl",
  "sec_url",
  "documentUrl",
  "document_url",
  "primaryDocumentUrl",
  "primary_document_url",
];

const citationLabelKeys = [
  "label",
  "title",
  "name",
  "source",
  "citation",
  "section",
  "sectionName",
  "section_name",
  "document",
  "text",
  "summary",
  "description",
];

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

function formatNullableScore(value: number | string | null) {
  if (value == null) {
    return "-";
  }

  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? formatScoreLabel(numericValue) : "-";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validExternalUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const url = new URL(value.trim());

    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function firstUrlInText(value: string) {
  const match = value.match(/https?:\/\/[^\s)\]}>,"]+/);

  return match ? validExternalUrl(match[0]) : null;
}

function firstStringByKeys(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function textFromUnknown(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (isRecord(value)) {
    const preferred = firstStringByKeys(value, [
      "finding",
      "summary",
      "text",
      "description",
      "title",
      "name",
      "value",
    ]);

    if (preferred) {
      return preferred;
    }
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function filingUrlForAnalysis(
  analysis: SignalScribeAnalysis,
  filings: SignalScribeFiling[],
) {
  const filing = filings.find(
    (candidate) => candidate.accession_number === analysis.accession_number,
  );

  return filing?.primary_document_url ?? filing?.sec_url ?? null;
}

function citationToSource(
  citation: unknown,
  fallbackUrl: string | null,
  index: number,
): SourceLink | null {
  if (typeof citation === "string") {
    const url = firstUrlInText(citation) ?? fallbackUrl;

    return url ? { label: citation.replace(url, "").trim() || "Source", url } : null;
  }

  if (!isRecord(citation)) {
    return fallbackUrl
      ? { label: `Source ${index + 1}`, url: fallbackUrl }
      : null;
  }

  const explicitUrl = citationUrlKeys
    .map((key) => validExternalUrl(citation[key]))
    .find(Boolean);
  const label =
    firstStringByKeys(citation, citationLabelKeys) ?? `Source ${index + 1}`;
  const url = explicitUrl ?? firstUrlInText(label) ?? fallbackUrl;

  return url ? { label, url } : null;
}

function sourceLinksForAnalysis(
  analysis: SignalScribeAnalysis,
  filings: SignalScribeFiling[],
) {
  const fallbackUrl = filingUrlForAnalysis(analysis, filings);
  const sources = analysis.source_citations
    .map((citation, index) => citationToSource(citation, fallbackUrl, index))
    .filter((source): source is SourceLink => Boolean(source));

  if (sources.length === 0 && fallbackUrl) {
    sources.push({
      label: `${analysis.form_type} ${analysis.accession_number}`,
      url: fallbackUrl,
    });
  }

  const seen = new Set<string>();

  return sources.filter((source) => {
    const key = `${source.label}|${source.url}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

function StatusPill({
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

function SourceLinks({ sources }: { sources: SourceLink[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 min-w-0">
      <div className="text-xs font-medium uppercase text-zinc-500">Sources</div>
      <div className="mt-2 flex min-w-0 flex-wrap gap-2">
        {sources.slice(0, 4).map((source) => (
          <a
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-xs text-cyan-100 hover:border-cyan-200/40 hover:text-cyan-50"
            href={source.url}
            key={`${source.label}-${source.url}`}
            rel="noreferrer"
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

function InsightPreviewList({
  title,
  values,
}: {
  title: string;
  values: unknown[];
}) {
  const displayValues = values.slice(0, 2).map(textFromUnknown).filter(Boolean);

  if (displayValues.length === 0) {
    return null;
  }

  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-3">
      <div className="text-xs font-medium uppercase text-zinc-500">{title}</div>
      <ul className="mt-2 grid min-w-0 gap-1.5 text-sm leading-6 text-zinc-300">
        {displayValues.map((value) => (
          <li
            className="min-w-0 break-words [overflow-wrap:anywhere]"
            key={value}
          >
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModalList({ title, values }: { title: string; values: unknown[] }) {
  const displayValues = values.map(textFromUnknown).filter(Boolean);

  if (displayValues.length === 0) {
    return null;
  }

  return (
    <section>
      <h3 className="text-xs font-medium uppercase text-zinc-500">{title}</h3>
      <ul className="mt-2 grid gap-2 text-sm leading-6 text-zinc-300">
        {displayValues.map((value, index) => (
          <li
            className="break-words rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 [overflow-wrap:anywhere]"
            key={`${title}-${index}-${value}`}
          >
            {value}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewButton({
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

function FilingReviewModal({
  filings,
  modal,
  onClose,
}: {
  filings: SignalScribeFiling[];
  modal: ModalState;
  onClose: () => void;
}) {
  const sourceLinks = useMemo(
    () =>
      modal?.kind === "analysis"
        ? sourceLinksForAnalysis(modal.analysis, filings)
        : [],
    [filings, modal],
  );

  useEffect(() => {
    if (!modal) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const originalOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modal, onClose]);

  if (!modal) {
    return null;
  }

  return (
    <div
      aria-label={
        modal.kind === "analysis" ? "Filing analysis details" : "Filing section details"
      }
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
      role="dialog"
    >
      <button
        aria-label="Close filing details"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />

      <section className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-xl border border-white/10 bg-[#151718] p-4 shadow-2xl lg:top-1/2 lg:left-1/2 lg:bottom-auto lg:w-[760px] lg:max-w-[calc(100vw-64px)] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-xl lg:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs uppercase text-zinc-500">
              {modal.kind === "analysis"
                ? `${modal.analysis.form_type} filing analysis`
                : "Filing section"}
            </div>
            <h2 className="mt-1 break-words text-xl font-semibold text-white [overflow-wrap:anywhere]">
              {modal.kind === "analysis"
                ? modal.analysis.accession_number
                : modal.section.section_name}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {modal.kind === "analysis"
                ? formatDateTime(modal.analysis.created_at)
                : `Chunk ${modal.section.chunk_index + 1}`}
            </p>
          </div>
          <button
            aria-label="Close filing details"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        {modal.kind === "analysis" ? (
          <div className="mt-5 grid gap-5">
            <section>
              <h3 className="text-xs font-medium uppercase text-zinc-500">
                Recent summary
              </h3>
              <p className="mt-2 break-words text-sm leading-6 text-zinc-300 [overflow-wrap:anywhere]">
                {modal.analysis.summary}
              </p>
            </section>
            {modal.analysis.business_summary ? (
              <section>
                <h3 className="text-xs font-medium uppercase text-zinc-500">
                  Business context
                </h3>
                <p className="mt-2 break-words text-sm leading-6 text-zinc-300 [overflow-wrap:anywhere]">
                  {modal.analysis.business_summary}
                </p>
              </section>
            ) : null}
            <ModalList title="Key findings" values={modal.analysis.key_findings} />
            <ModalList title="Financial summary" values={modal.analysis.financial_summary} />
            <ModalList title="Catalysts" values={modal.analysis.catalysts} />
            <ModalList title="Red flags" values={modal.analysis.red_flags} />
            <SourceLinks sources={sourceLinks} />
          </div>
        ) : (
          <div className="mt-5">
            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300 [overflow-wrap:anywhere]">
              {modal.section.section_text}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export function FilingAnalysisCards({
  analyses,
  filings,
}: {
  analyses: SignalScribeAnalysis[];
  filings: SignalScribeFiling[];
}) {
  const [modal, setModal] = useState<ModalState>(null);
  const latestAnalysis = analyses[0];
  const priorAnalyses = analyses.slice(1, 3);

  if (!latestAnalysis) {
    return <p className="text-sm text-zinc-500">No saved filing analysis.</p>;
  }

  const latestSources = sourceLinksForAnalysis(latestAnalysis, filings);

  return (
    <>
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
              {formatDateTime(latestAnalysis.created_at)}
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
            <InsightPreviewList title="Red flags" values={latestAnalysis.red_flags} />
          </div>

          <SourceLinks sources={latestSources} />

          <div className="mt-4">
            <ReviewButton onClick={() => setModal({ kind: "analysis", analysis: latestAnalysis })}>
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
                    {formatDateTime(analysis.created_at)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 break-words text-sm leading-6 text-zinc-400 [overflow-wrap:anywhere]">
                  {analysis.summary}
                </p>
                <div className="mt-3">
                  <ReviewButton
                    onClick={() => setModal({ kind: "analysis", analysis })}
                  >
                    <FileText className="size-4" />
                    Open analysis
                  </ReviewButton>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      <FilingReviewModal
        filings={filings}
        modal={modal}
        onClose={() => setModal(null)}
      />
    </>
  );
}

export function FilingSectionCards({
  sections,
}: {
  sections: SignalScribeSection[];
}) {
  const [modal, setModal] = useState<ModalState>(null);

  if (sections.length === 0) {
    return <p className="text-sm text-zinc-500">No saved sections found.</p>;
  }

  return (
    <>
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
              <ReviewButton onClick={() => setModal({ kind: "section", section })}>
                <BookOpen className="size-4" />
                Read section
              </ReviewButton>
            </div>
          </div>
        ))}
      </div>

      <FilingReviewModal
        filings={[]}
        modal={modal}
        onClose={() => setModal(null)}
      />
    </>
  );
}
