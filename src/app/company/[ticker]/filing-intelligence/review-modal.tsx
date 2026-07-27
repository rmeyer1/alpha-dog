import { X } from "lucide-react";
import { useMemo } from "react";
import { AccessibleOverlay } from "@/components/ui/accessible-overlay";
import { formatCompanyDateTime } from "@/lib/company-date-time";
import type {
  SignalScribeAnalysis,
  SignalScribeFiling,
  SignalScribeSection,
} from "@/lib/company-profile";
import { sourceLinksForAnalysis } from "./normalization";
import { ModalList, SourceLinks } from "./presentation";

export type ModalState =
  | { kind: "analysis"; analysis: SignalScribeAnalysis }
  | { kind: "section"; section: SignalScribeSection }
  | null;

export function FilingReviewModal({
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
  if (!modal) return null;
  return (
    <AccessibleOverlay
      description={
        modal.kind === "analysis"
          ? "Review the complete filing analysis and its source links. Press Escape to close."
          : "Read the complete filing section. Press Escape to close."
      }
      label={
        modal.kind === "analysis"
          ? "Filing analysis details"
          : "Filing section details"
      }
      onClose={onClose}
    >
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
                ? formatCompanyDateTime(modal.analysis.created_at)
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
            <ModalList
              title="Key findings"
              values={modal.analysis.key_findings}
            />
            <ModalList
              title="Financial summary"
              values={modal.analysis.financial_summary}
            />
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
    </AccessibleOverlay>
  );
}
