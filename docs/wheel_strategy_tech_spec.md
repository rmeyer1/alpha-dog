# Technical Architecture Specification: Wheel Strategy Options

## 1. System Overview
The system is a data-intensive financial application. The primary challenge is the "Screener," which requires filtering a massive dataset of option contracts in real-time.

### Architecture Pattern: Dynamic Query Builder
The system will avoid static endpoints for filtering. Instead, it will implement a **Query-Driven API**. The frontend sends a list of "Filter Operations," and the backend parses these into a database query.

## 2. Technology Stack (Recommended)
*   **Frontend:** React / Next.js (for SEO and fast routing) + Tailwind CSS.
*   **Backend:** Node.js (TypeScript) or Python (FastAPI) for high-performance data processing.
*   **Database:** 
    *   **PostgreSQL:** For user data, saved screeners, and trade tracking.
    *   **TimescaleDB or ClickHouse:** For the option chain data (high-volume time-series data).
*   **Cache:** Redis (for caching ticker data and common filter results).
*   **Data Sources:** Polygon.io, Tradier, or Alpaca (Market Data APIs for Option Chains and Stock Fundamentals).

## 3. API Design (Internal Specification)

### 3.1 The Filter Endpoint (`POST /api/filter`)
This is the core engine. It must accept a dynamic array of filters.

**Request Schema:**
```json
{
  "filters": [
    { "operation": "gte", "field": "annualizedReturn", "value": 2 },
    { "operation": "lte", "field": "delta", "value": 0.30 },
    { "operation": "eq", "field": "type", "value": "call" },
    { "operation": "excludeEarnings", "field": "earnings", "value": true }
  ],
  "paging": true,
  "pageNo": 1,
  "pageSize": 50,
  "sortBy": "contractScore",
  "sortDir": "desc"
}
```

**Response Schema:**
```json
{
  "totalResults": 1250,
  "data": [
    {
      "ticker": "AAPL",
      "strike": 150,
      "expiration": "2026-05-15",
      "premium": 2.50,
      "delta": 0.25,
      "iv": 0.32,
      "annualizedReturn": 12.5,
      "contractScore": 94,
      "pop": 75,
      "volume": 1200,
      "openInterest": 5000
    }
  ]
}
```

### 3.2 The Ticker Endpoint (`GET /api/tickers`)
Provides the list of all supported symbols for the search and "Available Stocks" page.
*   **Params:** `detailed=true` (returns market cap, sector, industry).

## 4. Data Pipeline & Processing
The system cannot query an external API for 500k contracts on every request. It must implement a **Data Sync Pipeline**:

1.  **Ingestion:** A background worker fetches the full option chain for a set of target tickers every 1-5 minutes.
2.  **Enrichment:** The worker calculates the derived metrics:
    *   `Premium Yield` = (Premium / Collateral) * (365 / DTE)
    *   `Contract Score` = Weighted sum of IV Rank, Delta, and Fundamental Quality.
    *   `PoP` = Derived from Delta.
3.  **Storage:** Data is written to the high-performance database.
4.  **Querying:** The `/filter` endpoint queries the *local* database, not the external API.

## 5. Component Breakdown
*   **Query Parser:** A module that converts the `filters` array into a SQL `WHERE` clause.
*   **Screener Engine:** Handles the sorting and pagination of the filtered results.
*   **Calculator Module:** A set of pure functions that implement the mathematical formulas for the 16 tools.
*   **Screener Cache:** Stores the result of popular filter combinations in Redis for sub-second response times.
