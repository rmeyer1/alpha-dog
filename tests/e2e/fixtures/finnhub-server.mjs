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

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/health") {
    response.writeHead(204).end();
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
