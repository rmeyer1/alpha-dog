# Wheel Strategy Dashboard — Internal API Specification

**Stack:** Next.js / Node.js / TypeScript  
**Style:** REST JSON APIs  
**External dependency:** Alpaca REST APIs  
**MVP scope:** Single ticker analysis, saved presets, no trade execution

---

## 1. API Principles

- Internal frontend calls use `/api/*` route handlers.
- Alpaca calls are made only server-side.
- API responses use normalized domain fields, not raw Alpaca payloads.
- All responses include data freshness metadata.
- Errors are structured and safe for UI rendering.

---

## 2. Authentication Assumption

MVP can start without user auth if this is a private tool.

However, API contracts should support future user accounts by including optional `userId` ownership on saved presets.

---

## 3. Endpoint: Analyze Wheel Candidates

### `POST /api/wheel/analyze`

Returns ranked short put and covered call candidates for a ticker.

#### Request

```json
{
  "ticker": "AAPL",
  "persona": "balanced_wheel",
  "filters": {
    "dteMin": 21,
    "dteMax": 30,
    "deltaMin": 0.15,
    "deltaMax": 0.30,
    "minPremiumYield": 0.01,
    "minVolume": 50,
    "minOpenInterest": 100,
    "maxSpreadPctOfMid": 0.20,
    "excludeEarnings": false,
    "includeWeeklies": true
  },
  "resultLimit": 25,
  "forceRefresh": false
}
```

#### Request Field Notes

- `ticker`: Required. Uppercase-equity symbol after normalization.
- `persona`: Required. One of supported persona IDs.
- `filters`: Optional overrides. Missing values come from persona defaults.
- `resultLimit`: Optional. Default 25 per tab.
- `forceRefresh`: Optional. If true, bypass fresh cache where safe.

#### Response

```json
{
  "ticker": "AAPL",
  "underlying": {
    "symbol": "AAPL",
    "price": 192.34,
    "asOf": "2026-05-25T17:45:00Z",
    "trend": "bullish",
    "rsi14": 61.4,
    "movingAverages": {
      "ma20": 188.1,
      "ma50": 181.7,
      "ma200": 172.2
    }
  },
  "persona": {
    "id": "balanced_wheel",
    "name": "Balanced Wheel"
  },
  "dataFreshness": {
    "feed": "opra",
    "cacheStatus": "fresh",
    "asOf": "2026-05-25T17:45:03Z",
    "nextSuggestedRefreshAt": "2026-05-25T17:47:03Z"
  },
  "shortPuts": [
    {
      "rank": 1,
      "score": 84,
      "contractSymbol": "AAPL260619P00185000",
      "optionType": "put",
      "strike": 185,
      "expirationDate": "2026-06-19",
      "dte": 25,
      "bid": 2.11,
      "ask": 2.18,
      "midpoint": 2.145,
      "spread": 0.07,
      "spreadPctOfMid": 0.0326,
      "premiumYield": 0.0116,
      "annualizedYield": 0.169,
      "delta": -0.22,
      "theta": -0.083,
      "impliedVolatility": 0.31,
      "volume": 185,
      "openInterest": 944,
      "distanceFromSpotPct": 0.0382,
      "breakeven": 182.855,
      "assignmentQuality": "good",
      "liquidityQuality": "good",
      "warnings": [
        {
          "type": "earnings",
          "severity": "warning",
          "message": "Earnings before expiration — premium may be inflated; gap and assignment risk elevated."
        }
      ],
      "scoreBreakdown": {
        "yield": 78,
        "deltaFit": 91,
        "dteFit": 96,
        "liquidity": 88,
        "technicalFit": 80,
        "eventRisk": 60,
        "volatilityRisk": 75,
        "assignmentQuality": 86
      }
    }
  ],
  "coveredCalls": [],
  "warnings": [],
  "errors": []
}
```

---

## 4. Endpoint: Get Strategy Personas

### `GET /api/wheel/personas`

Returns available strategy presets and default filters.

#### Response

```json
{
  "personas": [
    {
      "id": "conservative_wheel",
      "name": "Conservative Wheel",
      "motto": "Own quality, collect patiently.",
      "default": false,
      "filters": {
        "dteMin": 21,
        "dteMax": 45,
        "targetDeltaMin": 0.15,
        "targetDeltaMax": 0.20,
        "minPremiumYield": 0.0075,
        "minVolume": 50,
        "minOpenInterest": 100,
        "maxSpreadPctOfMid": 0.12,
        "excludeEarnings": true
      }
    },
    {
      "id": "balanced_wheel",
      "name": "Balanced Wheel",
      "motto": "Income with discipline.",
      "default": true
    },
    {
      "id": "aggressive_yield",
      "name": "Aggressive Yield",
      "motto": "Harvest yield, accept assignment risk.",
      "default": false
    }
  ]
}
```

---

## 5. Endpoint: Saved Presets

### `GET /api/presets`

Returns saved filter presets.

### `POST /api/presets`

Creates a saved preset.

#### Request

```json
{
  "name": "Balanced 21-30 DTE",
  "basePersona": "balanced_wheel",
  "filters": {
    "dteMin": 21,
    "dteMax": 30,
    "deltaMin": 0.15,
    "deltaMax": 0.30,
    "minPremiumYield": 0.01,
    "minOpenInterest": 100,
    "minVolume": 50,
    "maxSpreadPctOfMid": 0.20,
    "excludeEarnings": false
  }
}
```

### `PUT /api/presets/{presetId}`

Updates an existing preset.

### `DELETE /api/presets/{presetId}`

Deletes a saved preset.

---

## 6. Endpoint: Refresh Visible Contracts

### `POST /api/wheel/refresh-contracts`

Optional MVP endpoint for refreshing only visible/ranked contract symbols using Alpaca’s explicit option snapshots endpoint.

#### Request

```json
{
  "ticker": "AAPL",
  "contractSymbols": [
    "AAPL260619P00185000",
    "AAPL260619C00200000"
  ],
  "feed": "opra"
}
```

#### Behavior

- Validate max 100 symbols per request.
- Fetch `GET /v1beta1/options/snapshots?symbols=...`.
- Recompute row metrics using latest quote/greeks.
- Return updated rows.

---

## 7. Error Model

All internal API errors return:

```json
{
  "error": {
    "code": "ALPACA_RATE_LIMITED",
    "message": "Market data provider rate limit reached. Showing cached data if available.",
    "retryable": true,
    "details": {
      "cacheAvailable": true,
      "retryAfterSeconds": 60
    }
  }
}
```

Recommended error codes:

- `INVALID_TICKER`
- `UNSUPPORTED_TICKER`
- `NO_OPTIONS_FOUND`
- `NO_CONTRACTS_AFTER_FILTERS`
- `ALPACA_UNAUTHORIZED`
- `ALPACA_FORBIDDEN`
- `ALPACA_RATE_LIMITED`
- `ALPACA_UNAVAILABLE`
- `EARNINGS_PROVIDER_UNAVAILABLE`
- `INTERNAL_ANALYSIS_ERROR`

---

## 8. External Alpaca Client Requirements

The server-side Alpaca client must support:

- `getOptionChainSnapshots(params)`
- `getOptionSnapshotsBySymbols(symbols)`
- `getOptionContracts(params)`
- `getStockBars(symbol, range)`
- `getLatestStockQuote(symbol)`

Client behavior:

- Adds `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY` headers server-side.
- Handles pagination.
- Applies exponential backoff for retryable 5xx.
- Does not aggressively retry 429.
- Returns typed normalized objects.

---

## 9. API Acceptance Criteria

- `POST /api/wheel/analyze` returns both shortPut and coveredCall arrays.
- Response includes `dataFreshness.feed`, `cacheStatus`, and `asOf`.
- Alpaca auth headers are never exposed in frontend bundles or API responses.
- Saved preset CRUD works through REST endpoints.
- Force refresh bypasses fresh cache but still respects Alpaca rate limits.
- 429 failures can return stale cached data when available.
