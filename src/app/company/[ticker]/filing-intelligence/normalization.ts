export interface SourceLink {
  label: string;
  url: string;
}

export interface InsightItem {
  links: SourceLink[];
  text: string;
}

export interface FilingReference {
  accession_number: string;
  primary_document_url: string | null;
  sec_url: string | null;
}

export interface AnalysisReference {
  accession_number: string;
  form_type: string;
  source_citations: unknown[];
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function validExternalUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;

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

function linksFromText(value: string) {
  const matches = value.matchAll(
    /(?:\bURLs?:\s*)?(https?:\/\/[^\s)\]}>,"]+)/gi,
  );
  const seen = new Set<string>();
  const links: SourceLink[] = [];

  for (const match of matches) {
    const url = validExternalUrl(match[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({
      label: links.length === 0 ? "Source" : `Source ${links.length + 1}`,
      url,
    });
  }

  return links;
}

function removeUrlText(value: string) {
  return value
    .replace(/(?:\bURLs?:\s*)?https?:\/\/[^\s)\]}>,"]+/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function firstStringByKeys(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function textFromUnknown(value: unknown) {
  if (typeof value === "string") return value.trim();
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
    if (preferred) return preferred;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function insightLinksFromRecord(record: Record<string, unknown>) {
  const seen = new Set<string>();
  const links: SourceLink[] = [];
  for (const key of citationUrlKeys) {
    const url = validExternalUrl(record[key]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({
      label: links.length === 0 ? "Source" : `Source ${links.length + 1}`,
      url,
    });
  }
  return links;
}

export function insightFromUnknown(value: unknown): InsightItem | null {
  const text = textFromUnknown(value);
  const links = [
    ...(isRecord(value) ? insightLinksFromRecord(value) : []),
    ...linksFromText(text),
  ];
  const seen = new Set<string>();
  const uniqueLinks = links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
  const cleanText = removeUrlText(text);
  if (!cleanText && uniqueLinks.length === 0) return null;
  return {
    links: uniqueLinks.map((link, index) => ({
      ...link,
      label: index === 0 ? "Source" : `Source ${index + 1}`,
    })),
    text: cleanText,
  };
}

function filingUrlForAnalysis(
  analysis: AnalysisReference,
  filings: FilingReference[],
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
    return url
      ? { label: citation.replace(url, "").trim() || "Source", url }
      : null;
  }
  if (!isRecord(citation))
    return fallbackUrl
      ? { label: `Source ${index + 1}`, url: fallbackUrl }
      : null;
  const explicitUrl = citationUrlKeys
    .map((key) => validExternalUrl(citation[key]))
    .find(Boolean);
  const label =
    firstStringByKeys(citation, citationLabelKeys) ?? `Source ${index + 1}`;
  const url = explicitUrl ?? firstUrlInText(label) ?? fallbackUrl;
  return url ? { label, url } : null;
}

export function sourceLinksForAnalysis(
  analysis: AnalysisReference,
  filings: FilingReference[],
) {
  const fallbackUrl = filingUrlForAnalysis(analysis, filings);
  const sources = analysis.source_citations
    .map((citation, index) => citationToSource(citation, fallbackUrl, index))
    .filter((source): source is SourceLink => Boolean(source));

  if (sources.length === 0 && fallbackUrl)
    sources.push({
      label: `${analysis.form_type} ${analysis.accession_number}`,
      url: fallbackUrl,
    });

  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.label}|${source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
