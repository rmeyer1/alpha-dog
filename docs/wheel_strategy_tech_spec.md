# Technical Architecture Specification: Wheel Strategy Options

## 1. System Overview
The system is a data-intensive financial application. The primary challenge is the "Screener," which requires filtering a massive dataset of option contracts in real-time.

### Architecture Pattern: Dynamic Query Builder
The system will avoid static endpoints for filtering. Instead, it will implement a **Query-Driven API**. The frontend sends a list of "Filter Operations," and the backend parses these into a database query.

## 2. Technology Stack & Hosting Blueprint

The "Alpha-Dog" terminal uses a **Hybrid Architecture** to balance the high-speed requirements of a trading terminal with the scalability of modern hosting.

### 2.1 The Stack
*   **Frontend (The Terminal):** Next.js + Tailwind CSS $\rightarrow$ Hosted on **Vercel**.
*   **API & Analysis Engine (The Brain):** FastAPI (Python) $\rightarrow$ Hosted on **Railway.app / Render**.
*   **Data Core (The State):** Supabase (Postgres + Auth + Realtime) $\rightarrow$ Hosted on **Supabase**.
*   **Market Data:** Alpaca Market Data APIs (`alpaca-py`).

### 2.2 Hosting Strategy: Serverless UI vs. Persistent Engine
Because the system requires 24/7 data polling and heavy mathematical analysis, we decouple the UI from the Engine.

1.  **Vercel (Serverless):** Hosts the Next.js UI. It is highly scalable and provides the best user experience but cannot run persistent background tasks. It communicates with the API via HTTPS.
2.  **Railway/Render (Persistent):** Hosts two separate Python services:
    *   **The API Service:** A FastAPI server that handles user requests, translates filters, and queries Supabase.
    *   **The Data Worker:** A persistent background process that polls Alpaca, runs the `MARKET_MODEL` analysis, and updates Supabase.
3.  **Supabase (Managed):** Acts as the centralized state. The Worker writes to it; the API reads from it.

---

## 3. System Architecture: The Data Refinery

The core of the app is a **Data Refinery pipeline** that turns raw market data into high-conviction trade ideas.

### 3.1 The "Back-End" Loop (Refinery Process)
`Alpaca Market Data` $\xrightarrow{Polled by}$ `Railway Worker` $\xrightarrow{Analyzed by}$ `Market Model` $\xrightarrow{Stored in}$ `Supabase`

1.  **Collection:** The worker polls a "Hot List" of liquid tickers via Alpaca.
2.  **Analysis:** The worker applies the Trading Agent's logic (RSI, SMA, Support/Resistance zones) and calculates the `contractScore`.
3.  **Sync:** Processed data is flattened and pushed into Supabase tables.

### 3.2 The "Front-End" Loop (User Experience)
`User` $\xrightarrow{Interacts with}$ `Vercel UI` $\xrightarrow{Requests}$ `Railway FastAPI` $\xrightarrow{Queries}$ `Supabase` $\xrightarrow{Returns}$ `User`

1.  **Instant Filtering:** The UI sends a "Dynamic Query" to FastAPI.
2.  **Cache Query:** FastAPI queries the pre-calculated data in Supabase (avoiding slow Alpaca API calls during the user session).
3.  **Real-time Delivery:** The UI renders the results instantly.

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

## 3. API Design (Internal Specification)

### 3.1 The Filter Endpoint (`POST /api/filter`)
... (keep existing)

### 3.2 The Ticker Endpoint (`GET /api/tickers`)
... (keep existing)

### 3.3 The Charting Endpoint (`GET /api/chart/{symbol}`)
Provides historical bar data and structural overlays for visualization.
*   **Params:** `timeframe` (1Min, 5Min, 1Day), `range` (1Month, 6Month, 1Year).
*   **Logic:** FastAPI fetches bars from Alpaca $\rightarrow$ Applies SMA/RSI calculations $\rightarrow$ Fetches `support_zones` from Supabase $\rightarrow$ Returns a combined JSON object for the chart library.
*   **Frontend Integration:** Use **TradingView Lightweight Charts** for high-performance rendering of candles and zones.


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
