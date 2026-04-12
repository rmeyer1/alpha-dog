# Product Requirement Document (PRD): Wheel Strategy Options Clone

## 1. Executive Summary
The goal is to recreate a high-fidelity version of the "Wheel Strategy Options" platform. The platform is a specialized financial tool designed for traders employing the **Wheel Strategy** (selling Cash Secured Puts until assigned, then selling Covered Calls). The core value proposition is a high-dimensional options screener that filters millions of contracts based on probability, yield, and fundamentals.

## 2. User Personas
*   **The Income Seeker:** A conservative trader looking for consistent, low-risk premium collection (targets 0.15-0.30 Delta).
*   **The Aggressive Trader:** A trader chasing high yield and higher volatility (targets 0.50-0.70 Delta).
*   **The Beginner:** Someone learning the Wheel strategy who needs guided tools and calculators.

## 3. Core Functional Requirements

### 3.1 Option Screeners (Primary Feature)
The system must provide two primary screeners: **Covered Call Screener** and **Cash Secured Put Screener**.

#### 3.1.1 Dynamic Filtering Engine
The screeners must support a "Drawer" style advanced filter system with the following categories:
*   **Price & Premium:**
    *   Strike Price (Min/Max)
    *   Raw Premium (Min/Max)
    *   Premium Yield (Min/Max)
    *   Annualized Yield (Min/Max)
*   **Greeks & Metrics:**
    *   Delta (Min/Max)
    *   Implied Volatility (IV) (Min/Max)
    *   Probability of Profit (PoP) (Min/Max)
    *   Cushion (Min/Max)
*   **Contract Details:**
    *   Days to Expiration (DTE) (Min/Max)
    *   Volume (Min/Max)
    *   Liquidity Filter (Toggle: "Only show liquid contracts")
*   **Technical Indicators:**
    *   50-day SMA (Toggle/Crossover)
    *   200-day SMA (Toggle/Crossover)
    *   RSI 14D (Min/Max)
*   **Fundamentals:**
    *   Market Cap (Min/Max)
    *   PE Ratio (Min/Max)
    *   Sector/Industry (Dropdown)
    *   Exclude Symbol (Text input)
*   **Quality & Risks:**
    *   Proprietary Contract Rating (Min/Max)
    *   Earnings Proximity (Toggle: "Exclude earnings near expiration")

#### 3.1.2 Results Display
*   Real-time data table with sortable columns.
*   "Stream Live Data" toggle for real-time updates.
*   Ability to "Save Screener" configurations (User Account feature).
*   "AI Filter Builder" (Natural language to filter query conversion).

### 3.2 Discover Engine
A curated "Ideas" section providing high-probability trades.
*   **Categorization:** High IV, High Yield, Earnings.
*   **Trade Cards:** Display Symbol, Strategy (CC/CSP), Expiration, Contract Rating, Yield, IV, and Strike.
*   **Detailed View:** Expandable view showing Bid/Ask, Volume, Open Interest, and Delta.
*   **Screener Integration:** Link to view the specific trade inside the full screener with filters pre-applied.

### 3.3 Utility Tool Suite (Calculators)
A collection of standalone calculators providing instant financial math.
*   **Premium Yield Calculator:** (Premium / Collateral) * (365 / DTE).
*   **CSP Cash Calculator:** Calculates capital required (Strike * 100).
*   **Assignment Probability:** Convert Delta to PoP.
*   **Cost Basis After Assignment:** Calculates net cost including premium.
*   **IV Rank Calculator:** Compares current IV to 52-week range.
*   **Theta Decay Calculator:** Estimates daily value loss.
*   **Wheel Capital Calculator:** Total capital for full wheel cycle.
*   **Put Margin Calculator:** Estimates margin requirements.
*   **Covered Call Max Profit:** Max profit if assigned.
*   **Options Liquidity Checker:** Analyzes Volume/OI.
*   **Wheel Position Size:** Portfolio-based contract sizing.
*   **Covered Call vs Dividend:** Compares CC yield to dividend yield.
*   **Put Credit Spread Max Loss:** Worst-case loss calculation.
*   **Wheel Expectancy Calculator:** Expected return per cycle.

### 3.5 Interactive Technical Charting
A high-performance visualization tool to verify the "Structural Fit" of a trade.
*   **Interactive Candlestick Charts:** Using Alpaca historical bars to provide a professional trading view.
*   **Visual Overlays:**
    *   **Moving Averages:** SMA 50 and SMA 200 overlays to confirm trend alignment.
    *   **Structural Zones:** Visual horizontal bands representing the support and resistance zones identified by the backend Analyst.
    *   **Technical Indicators:** Integrated RSI and Volume profiles.
*   **Contextual Linking:** The chart should automatically center on the strike price of the selected option contract, allowing the user to see the "buffer" between the strike and the nearest structural support.


## 4. Non-Functional Requirements
*   **Performance:** The screener must handle a universe of 500k+ contracts with low latency.
*   **Data Accuracy:** Real-time options data with high refresh rates.
*   **Responsiveness:** Fully mobile-responsive UI.
*   **Scalability:** Backend must support concurrent users querying large datasets.

## 5. Success Criteria
*   Ability to replicate the "Dynamic Query Builder" API logic.
*   Accuracy of all calculators matching the original site.
*   Successful implementation of the "Contract Rating" scoring system.
*   Seamless transition from Discover $\rightarrow$ Screener $\rightarrow$ Trade Tracker.
