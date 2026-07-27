"use client";

import { useState } from "react";
import { FilingAnalysisCardList, FilingSectionCardList } from "./filing-intelligence/presentation";
import { FilingReviewModal, type ModalState } from "./filing-intelligence/review-modal";
import type {
  SignalScribeAnalysis,
  SignalScribeFiling,
  SignalScribeSection,
} from "@/lib/company-profile";

/**
 * Client facade for filing analysis cards. Keep this as the public entry point
 * so the parent page's serialization and client boundary remain unchanged.
 */
export function FilingAnalysisCards({
  analyses,
  filings,
}: {
  analyses: SignalScribeAnalysis[];
  filings: SignalScribeFiling[];
}) {
  const [modal, setModal] = useState<ModalState>(null);

  return (
    <>
      <FilingAnalysisCardList
        analyses={analyses}
        filings={filings}
        onReview={(analysis) => setModal({ kind: "analysis", analysis })}
      />
      <FilingReviewModal
        filings={filings}
        modal={modal}
        onClose={() => setModal(null)}
      />
    </>
  );
}

/**
 * Client facade for filing section cards. Keep this export stable for callers.
 */
export function FilingSectionCards({
  sections,
}: {
  sections: SignalScribeSection[];
}) {
  const [modal, setModal] = useState<ModalState>(null);

  return (
    <>
      <FilingSectionCardList
        onReview={(section) => setModal({ kind: "section", section })}
        sections={sections}
      />
      <FilingReviewModal filings={[]} modal={modal} onClose={() => setModal(null)} />
    </>
  );
}
