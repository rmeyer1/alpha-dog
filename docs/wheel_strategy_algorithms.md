# Wheel Strategy Dashboard — Scoring and Calculation Specification

**Purpose:** Define deterministic formulas and scoring behavior for short put and covered call ranking.  
**Design principle:** Premium is ranked only after risk, liquidity, technical context, and assignment/called-away quality are considered.

---

## 1. Shared Calculations

### 1.1 Midpoint

```text
midpoint = (bid + ask) / 2
```

If bid or ask is missing or <= 0, the contract should generally be excluded from MVP rankings.

### 1.2 Bid/Ask Spread

```text
spread = ask - bid
spreadPctOfMid = spread / midpoint
```

### 1.3 Days to Expiration

```text
dte = calendar_days(expirationDate - currentDate)
```

Use market date in America/New_York. Exclude expired contracts.

### 1.4 Premium Yield

For short puts:

```text
premiumYield = midpoint / strike
```

For covered calls:

```text
premiumYield = midpoint / underlyingPrice
```

The formula uses single-share values because the 100-share multiplier cancels out.

### 1.5 Annualized Yield

```text
annualizedYield = premiumYield * (365 / dte)
```

If `dte <= 0`, exclude the contract.

### 1.6 Distance From Spot

For puts:

```text
distanceFromSpotPct = (underlyingPrice - strike) / underlyingPrice
```

For calls:

```text
distanceFromSpotPct = (strike - underlyingPrice) / underlyingPrice
```

### 1.7 Short Put Breakeven

```text
breakeven = strike - midpoint
```

### 1.8 Covered Call Called-Away Price

```text
calledAwayPrice = strike + midpoint
```

### 1.9 Delta-Based Probability Proxy

Delta can be displayed as a rough probability proxy, but the UI must avoid implying certainty.

For short puts:

```text
approxOtmProbability = 1 - abs(delta)
```

For covered calls:

```text
approxNotCalledProbability = 1 - abs(delta)
```

---

## 2. Technical Indicators

### 2.1 Moving Averages

Compute from daily close prices:

```text
ma20 = average(last 20 daily closes)
ma50 = average(last 50 daily closes)
ma200 = average(last 200 daily closes)
```

### 2.2 RSI-14

Use standard 14-period RSI on daily closes.

Interpretation:

- `RSI >= 70`: overbought warning.
- `RSI <= 30`: oversold warning.
- For short puts, oversold can be risk warning, not automatic opportunity.
- For covered calls, overbought can improve call attractiveness but may also imply momentum risk.

### 2.3 Trend Classification

Recommended MVP rule:

```text
bullish if price > ma20 > ma50 and price > ma200
bearish if price < ma20 < ma50 or price < ma200
neutral otherwise
```

This is intentionally simple and explainable.

---

## 3. Liquidity Quality

### 3.1 Inputs

- Open interest.
- Daily volume.
- Absolute spread.
- Spread as percentage of midpoint.

### 3.2 Default Quality Bands

| Quality | Suggested Rule |
|---|---|
| excellent | OI >= 500, volume >= 200, spreadPctOfMid <= 5% |
| good | OI >= 250, volume >= 100, spreadPctOfMid <= 10% |
| acceptable | OI >= 100, volume >= 50, spreadPctOfMid <= 20% |
| weak | OI < 100 or volume < 50 or spreadPctOfMid > 20% |
| poor | midpoint invalid, spreadPctOfMid > 35%, or no meaningful bid |
| unknown | OI/volume unavailable but bid/ask usable |

Do not judge spread only by absolute dollars. A $0.05 spread on a $0.20 contract is poor; a $0.05 spread on a $2.00 contract may be acceptable.

---

## 4. Persona Defaults

### 4.1 Conservative Wheel

```json
{
  "dteMin": 21,
  "dteMax": 45,
  "targetDeltaPut": [0.15, 0.20],
  "targetDeltaCall": [0.15, 0.25],
  "minPremiumYield": 0.0075,
  "minOpenInterest": 100,
  "minVolume": 50,
  "maxSpreadPctOfMid": 0.12,
  "earningsPenalty": "high",
  "excludeEarningsDefault": true
}
```

### 4.2 Balanced Wheel

```json
{
  "dteMin": 21,
  "dteMax": 30,
  "targetDeltaPut": [0.15, 0.30],
  "targetDeltaCall": [0.20, 0.30],
  "idealDelta": 0.20,
  "minPremiumYield": 0.01,
  "minOpenInterest": 100,
  "minVolume": 50,
  "maxSpreadPctOfMid": 0.20,
  "earningsPenalty": "medium_high",
  "excludeEarningsDefault": false
}
```

### 4.3 Aggressive Yield

```json
{
  "dteMin": 7,
  "dteMax": 30,
  "targetDeltaPut": [0.25, 0.40],
  "targetDeltaCall": [0.30, 0.40],
  "minPremiumYield": 0.0125,
  "minOpenInterest": 100,
  "minVolume": 50,
  "maxSpreadPctOfMid": 0.25,
  "earningsPenalty": "medium",
  "excludeEarningsDefault": false
}
```

---

## 5. Score Model

### 5.1 Score Range

Each contract receives:

```text
score = 0 to 100
```

Score is persona-relative. A contract does not have one universal score.

### 5.2 Score Components

Each component is also normalized to 0–100:

- `yield`
- `deltaFit`
- `dteFit`
- `liquidity`
- `technicalFit`
- `eventRisk`
- `volatilityRisk`
- `assignmentQuality` for puts
- `upsideCapQuality` for calls
- `thetaEfficiency` for aggressive/weekly personas

### 5.3 Default Balanced Weights

#### Short Put

| Component | Weight |
|---|---:|
| Yield | 18% |
| Delta fit | 16% |
| DTE fit | 10% |
| Liquidity | 18% |
| Technical fit | 14% |
| Assignment quality | 12% |
| Event risk | 8% |
| Volatility risk | 4% |

#### Covered Call

| Component | Weight |
|---|---:|
| Yield | 18% |
| Delta fit | 16% |
| DTE fit | 10% |
| Liquidity | 18% |
| Technical fit | 12% |
| Upside cap quality | 14% |
| Event risk | 8% |
| Volatility risk | 4% |

### 5.4 Conservative Weight Bias

Increase:

- Liquidity
- Technical fit
- Assignment/upside quality
- Event risk penalty
- Volatility risk penalty

Decrease:

- Yield
- Theta efficiency

### 5.5 Aggressive Weight Bias

Increase:

- Yield
- Theta efficiency
- Delta tolerance

Decrease:

- Assignment/upside quality
- Event penalty severity
- Volatility penalty severity

Liquidity remains important for all personas.

---

## 6. Component Scoring Rules

### 6.1 Delta Fit

Score highest when absolute delta is within persona target range.

```text
if absDelta within target range: 100
else decay linearly as distance from target range increases
```

### 6.2 DTE Fit

Score highest inside persona DTE range. For Balanced:

- 21–30 DTE: 100
- 14–20 or 31–45: decays
- Outside configured range: excluded unless custom filters allow

### 6.3 Yield Score

For Balanced:

- Below 1% premium yield: reduced sharply.
- 1%–2.5%: rewarded.
- Extremely high yield: do not blindly max score; route excess to volatility/event warnings.

### 6.4 Technical Fit — Short Puts

Positive factors:

- Strike below spot.
- Strike at/below 20-day or 50-day MA when trend supports it.
- Breakeven below important moving averages.
- Bullish or neutral trend.

Negative factors:

- Bearish trend.
- Price below 200-day MA.
- RSI oversold with deteriorating trend.
- Strike above spot unless explicitly allowed.

### 6.5 Technical Fit — Covered Calls

Positive factors:

- Strike above current price.
- Strike near/above resistance proxy.
- Strike allows room in bullish trend.
- Overbought RSI can modestly improve fit.

Negative factors:

- Strike too close to spot during strong bullish trend.
- Low premium despite tight upside cap.
- Strike below major moving averages when price is recovering strongly.

### 6.6 Assignment Quality — Short Puts

Inputs:

- Breakeven.
- Strike versus MA20/MA50/MA200.
- Trend.
- Distance below spot.

Labels:

- `excellent`: breakeven below support/MA50 with bullish-neutral trend.
- `good`: strike below spot and technically defensible.
- `acceptable`: valid but not ideal.
- `weak`: bearish trend or strike technically vulnerable.
- `poor`: ITM/high-risk assignment unless explicitly aggressive.

### 6.7 Upside Cap Quality — Covered Calls

Inputs:

- Strike distance above spot.
- Delta.
- Trend.
- Premium received.

Labels:

- `excellent`: meaningful upside room + good premium.
- `good`: balanced cap/premium.
- `acceptable`: usable but imperfect.
- `weak`: caps upside too tightly.
- `poor`: likely to cap strong trend for insufficient premium.

---

## 7. Risk Warning Rules

### 7.1 Earnings Warning

Trigger when known earnings date is `<= expirationDate` and `>= currentDate`.

Message:

> Earnings before expiration — premium may be inflated; gap and assignment risk elevated.

If earnings provider unavailable:

> Earnings date unavailable — verify before trading.

### 7.2 High IV Warning

Trigger when IV is materially elevated. MVP can use one of:

- Static IV threshold by asset type.
- IV percentile/rank if historical IV exists.
- Cross-sectional comparison within same chain.

Message:

> High IV — premium is richer, but expected move and assignment risk are elevated.

### 7.3 Liquidity Warning

Trigger when liquidityQuality is `weak` or `poor`.

Message:

> Wide spread — expected edge may be reduced by poor fills.

### 7.4 Trend Warning

For short puts, trigger when trend is bearish.

Message:

> Bearish trend — avoid selling puts into weak structure unless intentionally aggressive.

### 7.5 Upside Cap Warning

For covered calls, trigger when trend is bullish and call strike is too close to spot.

Message:

> Call strike may cap upside too tightly for current trend.

---

## 8. Acceptance Criteria

- Scoring output changes when persona changes.
- Same contract can rank differently across Conservative, Balanced, and Aggressive personas.
- Liquidity impacts score materially for every persona.
- High premium alone cannot produce top rank if liquidity/event/technical risk is poor.
- Warnings are returned independently from numeric score.
- Score breakdown is produced internally even if row-level explanation is hidden in MVP.
