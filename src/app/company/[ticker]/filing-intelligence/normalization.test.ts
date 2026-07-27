import { describe, expect, it } from "vitest";
import {
  insightFromUnknown,
  sourceLinksForAnalysis,
  validExternalUrl,
} from "./normalization";

describe("filing intelligence normalization", () => {
  it("accepts only safe external source URLs", () => {
    expect(validExternalUrl(" https://www.sec.gov/Archives/doc.htm ")).toBe(
      "https://www.sec.gov/Archives/doc.htm",
    );
    expect(validExternalUrl("javascript:alert(1)")).toBeNull();
    expect(validExternalUrl("/relative-source")).toBeNull();
  });

  it("normalizes insight text and preserves citation order while removing duplicate URLs", () => {
    expect(
      insightFromUnknown({
        finding:
          "Margin expanded. Source: https://sec.example/a https://sec.example/b",
        source_url: "https://sec.example/a",
      }),
    ).toEqual({
      links: [
        { label: "Source", url: "https://sec.example/a" },
        { label: "Source 2", url: "https://sec.example/b" },
      ],
      text: "Margin expanded. Source:",
    });
  });

  it("uses the matched filing link as a citation fallback and keeps citation labels", () => {
    expect(
      sourceLinksForAnalysis(
        {
          accession_number: "0001",
          form_type: "10-K",
          source_citations: [
            { label: "MD&A", href: "https://sec.example/mda" },
            "Risk factors",
            { label: "MD&A", href: "https://sec.example/mda" },
          ],
        },
        [
          {
            accession_number: "0001",
            primary_document_url: "https://sec.example/filing",
            sec_url: "https://sec.example/index",
          },
        ],
      ),
    ).toEqual([
      { label: "MD&A", url: "https://sec.example/mda" },
      { label: "Risk factors", url: "https://sec.example/filing" },
    ]);
  });

  it("emits the filing citation when analysis citations are absent", () => {
    expect(
      sourceLinksForAnalysis(
        { accession_number: "0002", form_type: "8-K", source_citations: [] },
        [
          {
            accession_number: "0002",
            primary_document_url: null,
            sec_url: "https://sec.example/8k",
          },
        ],
      ),
    ).toEqual([{ label: "8-K 0002", url: "https://sec.example/8k" }]);
  });
});
