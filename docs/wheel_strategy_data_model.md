# Data Model Specification: Wheel Strategy Options

## 1. Entity Relationship Overview
The system centers around the `OptionContract` and the `StockTicker` entities.

## 2. Database Schema

### 2.1 Table: `tickers` (Fundamentals & Technicals)
| Field | Type | Description |
| :--- | :--- | :--- |
| `symbol` | PK (String) | Ticker symbol (e.g., "AAPL") |
| `company_name` | String | Full company name |
| `market_cap` | BigInt | Market capitalization in USD |
| `pe_ratio` | Float | Price-to-Earnings ratio |
| `sector` | String | Market sector |
| `industry` | String | Market industry |
| `sma_50` | Float | 50-day Simple Moving Average |
| `sma_200` | Float | 200-day Simple Moving Average |
| `rsi_14` | Float | 14-day Relative Strength Index |
| `current_price` | Float | Last traded stock price |
| `support_zones` | JSONB | Array of support price ranges `[{min: 150, max: 152}]` |
| `resistance_zones`| JSONB | Array of resistance price ranges `[{min: 170, max: 172}]` |
| `updated_at` | Timestamp | Last sync time |


### 2.2 Table: `option_contracts` (The Screener Data)
| Field | Type | Description |
| :--- | :--- | :--- |
| `contract_id` | PK (String) | Unique option ID (OSI standard) |
| `ticker` | FK (String) | Reference to `tickers.symbol` |
| `type` | Enum | "call" or "put" |
| `strike` | Float | Strike price |
| `expiration` | Date | Expiration date |
| `premium_mid` | Float | Midpoint of Bid/Ask |
| `bid` | Float | Current Bid |
| `ask` | Float | Current Ask |
| `delta` | Float | Delta Greek |
| `theta` | Float | Theta Greek |
| `vega` | Float | Vega Greek |
| `iv` | Float | Implied Volatility |
| `volume` | Int | Daily trading volume |
| `open_interest`| Int | Total open contracts |
| `annualized_yield`| Float | Calculated yield % |
| `contract_score` | Int | Calculated rating (0-100) |
| `pop` | Float | Probability of Profit % |
| `updated_at` | Timestamp | Last sync time |

### 2.3 Table: `user_trades` (Trade Tracker)
| Field | Type | Description |
| :--- | :--- | :--- |
| `trade_id` | PK (UUID) | Unique trade ID |
| `user_id` | FK (UUID) | Reference to `users.id` |
| `ticker` | String | Ticker traded |
| `strategy` | Enum | "CSP" or "CC" |
| `entry_date` | Date | Date trade was opened |
| `exit_date` | Date | Date trade was closed |
| `entry_premium` | Float | Total premium collected |
| `strike` | Float | Strike price of contract |
| `status` | Enum | "Open", "Closed", "Assigned", "Expired" |
| `pnl` | Float | Realized profit/loss |

### 2.4 Table: `saved_screeners`
| Field | Type | Description |
| :--- | :--- | :--- |
| `screener_id` | PK (UUID) | Unique ID |
| `user_id` | FK (UUID) | Reference to `users.id` |
| `name` | String | Custom name (e.g. "Safe AAPL Puts") |
| `filter_json` | JSONB | The array of filter operations |
| `created_at` | Timestamp | Creation date |

## 3. Indexing Strategy
*   **B-Tree Index:** On `tickers.symbol` and `option_contracts.contract_id`.
*   **Composite Index:** On `option_contracts(type, expiration, strike)` for fast chain lookups.
*   **GIST/GIN Index:** On `saved_screeners.filter_json` for searching across saved configurations.
*   **Partitioning:** Partition `option_contracts` by `expiration` date to keep the active set small and fast.
