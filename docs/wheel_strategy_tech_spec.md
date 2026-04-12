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

## 3. API Design & Data Source Mapping

The "Alpha-Dog" engine relies on the Alpaca Market Data API. To avoid "recreating the wheel," we leverage Alpaca's native data objects wherever possible.

### 3.1 Alpaca Data Source Mapping
The backend worker uses the following endpoints to fuel the refinery:

| Data Need | Alpaca Endpoint / SDK SDK Method | Documentation Link | Use Case |
| :--- | :--- | :--- | :--- |
| **Active Contracts** | `get_option_contracts` | [Option Contracts](https://docs.alpaca.markets/reference/optionchain) | Populating the initial options universe. |
| **Greeks & Pricing** | `get_option_snapshot` | [Option Snapshots](https://docs.alpaca.markets/reference/optionchain) | Fetching Delta, Theta, Vega, Bid, Ask, and IV. |
| **Stock Real-time Price** | `get_stock_snapshot` | [Stock Snapshots](https://docs.alpaca.markets/reference/stock) | Syncing current underlying price with option strikes. |
| **Historical Price** | `get_option_bars` | [Option Bars](https://docs.alpaca.markets/reference/optionchain) | Powering the interactive candlestick charts. |
| **Stock Data** | `get_stock_bars` | [Stock Bars](https://docs.alpaca.markets/reference/bars) | Calculating SMA 50/200 and RSI. |
| **Ticker Details** | `get_asset` | [Assets API](https://docs.alpaca.markets/reference/assets) | Fetching company name and basic asset info. |

### 3.2 The "Data Refinery" Engine Architecture
The refinery is a decoupled, asynchronous pipeline designed to maximize the Alpaca free-tier limits.

#### Step 1: Ticker Polling (The Seed)
*   **Action:** Poll a curated "Hot List" of liquid symbols.
*   **Tool:** `TradingClient.get_option_contracts`.
*   **Output:** A list of active, liquid contracts for the target symbols.

#### Step 2: Chain Snapshotting (The Meat)
*   **Action:** Batch request snapshots for all active contracts.
*   **Tool:** `OptionHistoricalDataClient.get_option_snapshot`.
*   **Leverage:** We use Alpaca's **native Greeks** (Delta, Theta, Vega) and **IV** provided in the snapshot instead of calculating them locally.

#### Step 3: Technical Enrichment (The Edge)
*   **Action:** Fetch historical stock bars for the underlying.
*   **Tool:** `get_stock_bars`.
*   **Process:** Apply `pandas-ta` to the bar data to generate:
    *   **SMA 50/200:** To confirm the market regime.
    *   **RSI (14):** To identify overbought/oversold conditions.
    *   **Structural Zones:** Identify local support/resistance by analyzing price pivots over the last 60-180 days.

#### Step 4: Scoring & Yield Calculation (The Logic)
*   **Action:** Combine Alpaca's native data with our calculated indicators.
*   **Formula:** Run the `contractScore` weighted model (Delta, Yield, IV Rank, Structural Fit).
*   **Calculation:** Compute `Annualized Yield` based on the snapshot's mid-price.

#### Step 5: Supabase Sync (The State)
*   **Action:** Upsert the final "Enriched Contract" into the `option_contracts` table.
*   **Output:** A ready-to-query database that the Vercel UI can access instantly.

---

## 4. Internal API Endpoints (FastAPI)

### 4.1 The Filter Endpoint (`POST /api/filter`)
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

### 4.2 The Ticker Endpoint (`GET /api/tickers`)
Provides the list of all supported symbols for the search and "Available Stocks" page.
*   **Params:** `detailed=true` (returns market cap, sector, industry).

### 4.3 The Charting Endpoint (`GET /api/chart/{symbol}`)
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
