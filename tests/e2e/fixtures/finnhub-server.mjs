import { createServer } from "node:http";

const port = 3_101;
const responses = new Map([
  ["/api/v1/stock/earnings", []],
  [
    "/api/v1/stock/metric",
    {
      metric: {},
      metricType: "all",
      series: {},
      symbol: "BRK.B",
    },
  ],
  [
    "/api/v1/company-news",
    [
      {
        category: "company",
        datetime: 1_784_968_080,
        headline: "Deterministic timezone regression fixture",
        id: 13,
        related: "BRK.B",
        source: "Alpha Dog test",
        summary: "Fixed server data exercises Client Component hydration.",
        url: "https://example.com/company-news-fixture",
      },
    ],
  ],
  [
    "/api/v1/stock/profile2",
    {
      country: "US",
      currency: "USD",
      exchange: "NYSE",
      finnhubIndustry: "Insurance",
      marketCapitalization: 962_000,
      name: "Berkshire Hathaway",
      shareOutstanding: 1,
      ticker: "BRK.B",
    },
  ],
  ["/api/v1/stock/recommendation", []],
]);

const signalScribeResponses = new Map([
  [
    "companies",
    [
      {
        cik: "0001067983",
        company_name: "Berkshire Hathaway",
        exchange: "NYSE",
        id: "company-brkb",
        industry: "Insurance",
        sector: "Financial Services",
        sic: "6331",
        ticker: "BRK.B",
      },
    ],
  ],
  [
    "filing_analysis",
    [
      {
        accession_number: "0001067983-26-000001",
        business_summary: "A diversified operating and investment company.",
        catalysts: ["Insurance underwriting discipline"],
        created_at: "2026-07-23T18:00:00.000Z",
        financial_summary: ["Liquidity remains substantial"],
        form_type: "10-Q",
        id: "analysis-brkb",
        key_findings: ["Operating earnings remained resilient"],
        management_tone: "measured",
        quality_score: 91,
        red_flags: ["Equity portfolio concentration"],
        risk_score: 34,
        source_citations: [
          {
            label: "SEC filing",
            url: "https://www.sec.gov/Archives/edgar/data/1067983/fixture.htm",
          },
        ],
        summary: "Deterministic filing analysis for accessibility verification.",
      },
    ],
  ],
  [
    "filings",
    [
      {
        accession_number: "0001067983-26-000001",
        filing_date: "2026-07-23",
        fiscal_period: "Q2",
        fiscal_year: 2026,
        form_type: "10-Q",
        id: "filing-brkb",
        primary_document_url:
          "https://www.sec.gov/Archives/edgar/data/1067983/fixture.htm",
        report_date: "2026-06-30",
        sec_url:
          "https://www.sec.gov/Archives/edgar/data/1067983/fixture.htm",
      },
    ],
  ],
  ["financial_facts", []],
  [
    "filing_sections",
    [
      {
        chunk_index: 0,
        filing_id: "filing-brkb",
        id: "section-brkb",
        section_name: "Management discussion",
        section_text:
          "Deterministic filing section used for keyboard and zoom verification.",
      },
    ],
  ],
]);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/health") {
    response.writeHead(204).end();
    return;
  }

  if (url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.split("/").at(-1) ?? "";
    const ticker = url.searchParams.get("ticker") ??
      url.searchParams.get("company_ticker");
    const body = ticker && ticker !== "eq.BRK.B"
      ? []
      : signalScribeResponses.get(table);

    if (body === undefined) {
      response
        .writeHead(404, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "Unknown Signal Scribe test table." }));
      return;
    }

    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(body));
    return;
  }

  const body = responses.get(url.pathname);

  if (body === undefined) {
    response
      .writeHead(404, { "content-type": "application/json" })
      .end(JSON.stringify({ error: "Unknown Finnhub test endpoint." }));
    return;
  }

  response
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify(body));
});

server.listen(port, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
