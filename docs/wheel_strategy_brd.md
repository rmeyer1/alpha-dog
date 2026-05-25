---
title: "Business Requirements Document: Wheel Strategy Dashboard"
date: 2026-05-25
owner: "Paper Prophet / Trading Workflow"
status: "Draft for Development Review"
tags: [trading, options, wheel-strategy, brd, alpaca, premium-selling]
---

# Business Requirements Document: Wheel Strategy Dashboard

## 1. Executive Summary

The proposed product is a wheel strategy decision dashboard for options premium sellers. The dashboard should help users search an equity ticker, evaluate short put and covered call opportunities, and rank available contracts according to strategy-specific risk/reward criteria.

The product should not behave like a raw option-chain viewer. It should behave like an income-trading decision system: it should organize option contracts around premium yield, delta, liquidity, technical context, earnings risk, volatility risk, and assignment/called-away implications.

The initial proof of concept should focus on single-ticker search and ranked contract outputs. The system should be designed with a scalable multi-user future in mind, but the first version can use a default trading profile modeled around disciplined premium-selling behavior.

The guiding principle is simple:

> Rank income only after risk, liquidity, technical context, and assignment quality are considered.

High premium alone should not dominate the default score.

---

## 2. Business Objective

The dashboard should help premium sellers answer the following questions quickly:

1. What short put contracts are worth considering for this ticker?
2. What covered call contracts are worth considering for this ticker?
3. Which contracts offer attractive premium without unacceptable liquidity, event, or assignment risk?
4. How does the ranking change if the user is conservative, balanced, or aggressive?
5. Is the option premium attractive because the setup is high quality, or because the underlying carries elevated risk?

The product should reduce manual chain-hopping, improve consistency, and help traders avoid low-quality premium traps.

---

## 3. Target Users

### 3.1 Primary User

A retail or semi-active options trader who sells premium using the wheel strategy or wheel-adjacent income strategies.

This user wants:

- Fast ticker-based discovery.
- Short put candidates.
- Covered call candidates.
- Yield and premium visibility.
- Delta and DTE control.
- Liquidity warnings.
- Earnings warnings.
- Strategy presets that match different risk profiles.

### 3.2 Future Users

Future versions may support:

- Multi-user accounts.
- Saved user profiles.
- Broker-connected portfolio awareness.
- Watchlist scanning.
- Position-aware covered call suggestions.
- Cash/collateral-aware short put sizing.

---

## 4. Product Positioning

This product should sit between a raw options chain and a professional premium-selling workflow.

It should be more opinionated than a broker chain, but less prescriptive than an automated trading system.

The dashboard should not place trades, recommend trades as guaranteed outcomes, or encourage blind yield chasing. It should rank and contextualize opportunities so the user can make better decisions.

The product voice should be disciplined, risk-aware, and direct:

- Survive first.
- Define risk first.
- Premium is not free money.
- Assignment risk is real.
- Earnings risk must be visible.
- Wide spreads are a tax.
- Cash is a valid position.

---

## 5. MVP Scope

### 5.1 In Scope for MVP

The MVP should include:

- Single ticker search.
- Separate result tabs for:
  - Short Puts
  - Covered Calls
- Ranked option contracts for the queried ticker.
- Strategy preset selection.
- Saved filter presets.
- Visible risk warnings.
- Premium yield and annualized yield.
- Delta and theta visibility.
- DTE visibility.
- Strike and expiration visibility.
- Bid, ask, and midpoint awareness.
- Liquidity quality assessment.
- Earnings date warning if earnings occur before expiration.
- High-IV / volatility warning.
- Trend classification: bullish, neutral, or bearish.
- RSI warnings.
- 20-day, 50-day, and 200-day moving average context.
- Assignment price / called-away strike relationship to moving averages.

### 5.2 Out of Scope for MVP

The MVP should not include:

- Full market-wide scanner.
- Watchlist scanner.
- Trade execution.
- Broker order placement.
- Portfolio-aware covered call eligibility.
- Buying power or collateral sizing.
- Sector concentration risk.
- Position management workflow.
- Rolling workflow.
- Tax-lot tracking.
- User prompt: “Would I own 100 shares at this strike?”
- Full row-level explanation of every scoring component.

These should be preserved as post-MVP opportunities.

---

## 6. Core User Workflow

### 6.1 Basic Search Flow

1. User enters a ticker symbol.
2. User selects or confirms a strategy preset.
3. Dashboard returns two primary views:
   - Short Puts
   - Covered Calls
4. User reviews ranked contracts.
5. User compares premium, delta, DTE, liquidity, event risk, and technical context.
6. User may adjust filters or switch strategy persona.
7. Dashboard re-ranks contracts according to the selected persona.

### 6.2 Required UX Behavior

The default experience should feel like:

> “Show me the best wheel candidates for this ticker based on my strategy style.”

The user should not need to manually scan dozens of expirations and strikes before identifying reasonable candidates.

---

## 7. Strategy Personas and Presets

The product should treat presets as trader personas, not just static filters.

Each persona should change:

- Filter defaults.
- Scoring weights.
- Risk tolerance.
- Event-risk penalty.
- Volatility penalty.
- Yield preference.
- Assignment/called-away tolerance.

The same contract may score differently under different personas. That is intentional.

---

## 8. Persona 1: Conservative Income Seller

### 8.1 Persona Name

**Conservative Wheel**

### 8.2 Persona Motto

**Own quality, collect patiently.**

### 8.3 Primary Goal

Generate income only where the underlying is acceptable to own or continue holding.

This user values quality, downside buffer, and clean assignment prices more than maximizing premium.

### 8.4 Best Fit

- ETFs.
- Large-cap stocks.
- Stable companies.
- Traders who want lower churn.
- Traders who do not want to be forced into poor assignments.

### 8.5 Short Put Preference

The Conservative Wheel short put screen should prefer:

- Delta around 0.15–0.20.
- DTE around 21–45 days, with 21–30 as a strong default zone.
- Strike below spot.
- Strike near or below meaningful support.
- Strike near or below the 50-day moving average when appropriate.
- Strong liquidity.
- No earnings before expiration, or heavy penalty if earnings are present.
- Bullish or neutral underlying trend.

### 8.6 Covered Call Preference

The Conservative Wheel covered call screen should prefer:

- Delta around 0.15–0.25.
- Strike above current range.
- Strike above nearby resistance when possible.
- Enough premium to justify the cap on upside.
- Avoid selling too close to spot during strong bullish trends.
- Allow shares room to appreciate.

### 8.7 Scoring Bias

The Conservative Wheel should weight:

- Risk buffer: high.
- Technical quality: high.
- Liquidity: high.
- Assignment quality: high.
- Yield: medium.
- Event-risk penalty: high.
- Extreme volatility penalty: high.

### 8.8 User-Facing Warning Style

This persona should be quick to warn:

- “Earnings before expiration.”
- “Spread too wide for conservative income.”
- “Premium is attractive, but assignment quality is weak.”
- “Underlying trend is bearish; avoid catching a falling knife.”

---

## 9. Persona 2: Balanced Wheel Seller

### 9.1 Persona Name

**Balanced Wheel**

### 9.2 Persona Motto

**Income with discipline.**

### 9.3 Primary Goal

Balance premium yield, probability, liquidity, technical context, and assignment quality.

This should be the default product preset.

### 9.4 Best Fit

- Most users.
- Standard wheel workflows.
- Traders who want yield but do not want to blindly chase risk.

### 9.5 Short Put Preference

The Balanced Wheel short put screen should prefer:

- Target delta around 0.20.
- Acceptable delta band around 0.15–0.30.
- DTE around 21–30 days.
- Minimum premium yield of 1% or greater.
- Strike below spot.
- Better ranking when strike is near support or below/near the 50-day moving average.
- Earnings before expiration allowed but penalized and visibly warned.
- High IV allowed but risk-adjusted.

### 9.6 Covered Call Preference

The Balanced Wheel covered call screen should prefer:

- Target delta around 0.20–0.30.
- Strike above current range or near resistance.
- Reasonable premium without overly sacrificing upside.
- Penalize selling calls too close when trend is strongly bullish.
- Penalize low premium on illiquid contracts.

### 9.7 Scoring Bias

The Balanced Wheel should weight:

- Yield: medium-high.
- Risk buffer: medium-high.
- Liquidity: high.
- Technical quality: medium-high.
- Assignment/called-away quality: medium-high.
- Event-risk penalty: medium-high.
- Extreme volatility penalty: medium.

### 9.8 User-Facing Warning Style

This persona should be clear but not overly restrictive:

- “Earnings before expiration — risk elevated.”
- “High IV — premium attractive but volatility risk elevated.”
- “Spread is wider than preferred.”
- “Trend is neutral/bearish; assignment quality reduced.”

---

## 10. Persona 3: Aggressive Premium Seller

### 10.1 Persona Name

**Aggressive Yield**

### 10.2 Persona Motto

**Harvest yield, accept assignment risk.**

### 10.3 Primary Goal

Prioritize premium yield and theta efficiency while still avoiding broken liquidity.

This persona accepts greater volatility, assignment risk, and active management requirements.

### 10.4 Best Fit

- Active premium sellers.
- High-IV names.
- Traders willing to manage, roll, or accept assignment.
- Smaller position sizing.
- Users who understand that high yield usually means high risk.

### 10.5 Short Put Preference

The Aggressive Yield short put screen should prefer:

- Target delta around 0.25–0.35.
- May allow up to around 0.40 depending on user settings.
- DTE around 7–30 days.
- Weekly variants allowed.
- Higher premium yield.
- Higher theta efficiency.
- High IV allowed and partially rewarded.
- Earnings before expiration allowed but loudly flagged.
- Assignment price still considered, but less dominant than yield.

### 10.6 Covered Call Preference

The Aggressive Yield covered call screen should prefer:

- Target delta around 0.30–0.40.
- Richer premium.
- Willingness to cap upside sooner.
- Better fit for shares the user is willing to let go.
- Liquidity remains important.

### 10.7 Scoring Bias

The Aggressive Yield preset should weight:

- Yield: very high.
- Theta efficiency: high.
- Liquidity: high.
- Risk buffer: medium.
- Technical quality: medium.
- Assignment/called-away quality: medium-low.
- Event risk: visible warning, smaller penalty than other presets.
- Extreme volatility: warning, but not automatic exclusion.

### 10.8 User-Facing Warning Style

This persona should be blunt:

- “Higher income, higher assignment/gap risk.”
- “Earnings before expiration — premium may be inflated.”
- “High IV name — size accordingly.”
- “This ranks well for yield, not safety.”

---

## 11. Additional Presets

### 11.1 Weekly Theta

Purpose: Find shorter-dated premium opportunities where theta decay is stronger.

Suggested behavior:

- DTE: 7–14 days.
- Delta: around 0.20 for default version.
- Liquidity requirements should be stricter.
- Earnings warnings should be prominent.
- Wide spreads should be penalized heavily.
- Better suited for active monitoring.

### 11.2 High IV Hunter

Purpose: Surface high-premium opportunities without hiding the associated risk.

Suggested behavior:

- High IV is allowed and may improve opportunity score.
- Extreme IV still triggers warnings.
- Earnings and binary event warnings should be prominent.
- Liquidity must remain acceptable.
- The UI should clearly separate “premium opportunity” from “risk quality.”

### 11.3 Custom

Purpose: Allow users to save custom filter and ranking preferences.

Custom should eventually support:

- Delta range.
- DTE range.
- Minimum premium yield.
- Minimum volume.
- Minimum open interest.
- Maximum bid/ask spread.
- Earnings treatment.
- IV treatment.
- Technical preference.
- Saved preset name.

---

## 12. Default Filter Requirements

### 12.1 Default DTE

The default DTE bucket should be 21–30 days.

This balances:

- Sufficient premium.
- Meaningful theta decay.
- Enough time to manage if challenged.
- Avoiding excessive long-dated exposure.

### 12.2 Default Delta

The default target should be approximately 0.20 delta for both short puts and covered calls.

Rationale:

- Around 80% probability of expiring out-of-the-money, using delta as a rough proxy.
- Supports income generation without becoming aggressively directional.
- Aligns with disciplined premium-selling behavior.

### 12.3 Minimum Premium Yield

Default minimum premium yield should be 1% or greater.

Contracts below that may still be visible if the user changes filters, but they should not be favored by the default ranking.

### 12.4 Liquidity Expectations

The system should judge liquidity using both absolute and relative measures.

Suggested default expectations:

- Prefer open interest of 100 or greater.
- Stronger ranking for open interest of 250–500 or greater.
- Prefer daily volume of 50 or greater.
- Stronger ranking for daily volume of 100–200 or greater.
- Ideal bid/ask spread: $0.01–$0.05.
- Spread should also be measured as a percentage of midpoint or premium.

A $0.05 spread on a $0.20 option is poor. A $0.05 spread on a $2.00 option may be acceptable.

Liquidity should be a major part of the ranking because poor fills can destroy the expected edge of premium selling.

---

## 13. Required Contract Metrics

Each ranked contract row should display, at minimum:

- Symbol.
- Underlying price.
- Option type: put or call.
- Strike.
- Expiration.
- DTE.
- Bid.
- Ask.
- Midpoint.
- Premium yield.
- Annualized yield.
- Delta.
- Theta.
- Implied volatility if available.
- Volume.
- Open interest if available.
- Bid/ask spread.
- Spread quality indicator.
- Earnings date if available.
- Earnings-before-expiration warning.
- Trend classification.
- RSI warning.
- 20-day moving average context.
- 50-day moving average context.
- 200-day moving average context.
- Score/rank.

---

## 14. Required Short Put Decision Factors

Short put ranking should consider:

- Premium yield.
- Annualized yield.
- Delta.
- DTE.
- Liquidity.
- Bid/ask spread quality.
- Distance from spot to strike.
- Breakeven price.
- Assignment price quality.
- Strike relationship to 20/50/200 moving averages.
- Trend classification.
- RSI extension.
- Earnings before expiration.
- IV / volatility risk.

The tool should favor short puts where the strike is below spot and where assignment would occur at a price that is technically defensible.

---

## 15. Required Covered Call Decision Factors

Covered call ranking should consider:

- Premium yield.
- Annualized yield.
- Delta.
- DTE.
- Liquidity.
- Bid/ask spread quality.
- Strike distance above spot.
- Called-away price.
- Upside cap.
- Strike relationship to resistance/current range.
- Strike relationship to 20/50/200 moving averages.
- Trend classification.
- RSI extension.
- Earnings before expiration.
- IV / volatility risk.

The tool should avoid over-rewarding calls that produce decent premium but cap a strong bullish stock too aggressively, especially under Conservative or Balanced presets.

---

## 16. Risk Warnings

The dashboard should include visible warnings, not hidden footnotes.

Required warnings include:

### 16.1 Earnings Risk

Display warning when earnings occur before expiration.

Suggested wording:

> Earnings before expiration — premium may be inflated; gap and assignment risk elevated.

### 16.2 High IV / Volatility Risk

Display warning when implied volatility is materially elevated.

Suggested wording:

> High IV — premium is richer, but expected move and assignment risk are elevated.

### 16.3 Liquidity Risk

Display warning when spread or liquidity is weak.

Suggested wording:

> Wide spread — expected edge may be reduced by poor fills.

### 16.4 Trend Risk

Display warning when short put candidates appear on bearish or deteriorating underlyings.

Suggested wording:

> Bearish trend — avoid selling puts into weak structure unless intentionally aggressive.

### 16.5 Upside Cap Risk

Display warning when covered calls cap upside too closely during bullish conditions.

Suggested wording:

> Call strike may cap upside too tightly for current trend.

---

## 17. Ranking Philosophy

The score should be strategy-relative.

A contract should not receive a universal “good” or “bad” label without context. Instead, it should be ranked according to the selected persona.

Example:

A high-IV, 0.32-delta put with earnings before expiration may be:

- Low-ranked or excluded for Conservative Wheel.
- Allowed but penalized for Balanced Wheel.
- Highly ranked but heavily warned for Aggressive Yield.

This is a core product requirement.

---

## 18. MVP Acceptance Criteria

The MVP should be considered successful if a user can:

1. Enter a ticker.
2. Select a strategy preset.
3. View ranked short put contracts.
4. View ranked covered call contracts.
5. See premium yield, annualized yield, delta, theta, DTE, and strike details.
6. See liquidity quality and bid/ask spread warnings.
7. See earnings-before-expiration warnings when applicable.
8. See trend classification and RSI warnings.
9. Compare how contract rankings change between Conservative, Balanced, and Aggressive presets.
10. Save and reuse filter presets.

The MVP should not require broker-connected portfolio data to be useful.

---

## 19. Post-MVP Opportunities

### 19.1 Watchlist Scanner

Allow users to scan a saved ticker watchlist and surface best wheel candidates across multiple names.

### 19.2 Portfolio Awareness

Allow the dashboard to tailor outputs based on actual holdings, cash, buying power, and open positions.

Potential features:

- Covered calls only for tickers where the user owns 100+ shares.
- Short put collateral awareness.
- Max contract sizing.
- Concentration risk warnings.
- Sector exposure warnings.

### 19.3 Assignment Quality Prompt

Add a user-facing decision checkpoint:

> Would I own 100 shares at this strike?

This should not block MVP, but should be preserved as an important future risk-control feature.

### 19.4 Explainable Ranking

Add expandable row explanations showing why each contract ranked where it did.

Example:

- Good: 0.20 delta, 24 DTE, 1.4% premium yield, tight spread.
- Watch: earnings before expiration.
- Risk: elevated IV and bearish short-term trend.

### 19.5 Position Management

Future versions may support:

- Open trade tracking.
- Profit target alerts.
- Roll candidate identification.
- Earnings risk reminders.
- Assignment management.

---

## 20. Non-Goals

The product should not:

- Guarantee profitability.
- Recommend blind trades.
- Encourage yield chasing without risk context.
- Hide earnings risk.
- Hide liquidity risk.
- Treat all high-IV names as good opportunities.
- Replace user judgment.
- Execute trades in MVP.

---

## 21. Business Risks

### 21.1 Yield-Chasing Behavior

Users may sort by premium and ignore risk. The product must counter this by making risk warnings visible and by ensuring default rankings are risk-adjusted.

### 21.2 Misunderstanding Assignment Risk

Users may view short puts as income without recognizing obligation to buy shares. The product should emphasize assignment price, breakeven, and trend context.

### 21.3 Poor Liquidity

Option contracts with attractive theoretical yields may be difficult to enter or exit. The product must penalize and warn on weak liquidity.

### 21.4 Earnings Events

Earnings can inflate premium and create gap risk. The product must show earnings timing prominently.

### 21.5 Overfitting the POC to One Trader

The POC can use Rob’s defaults, but the product should preserve multi-user scalability through presets and future profile customization.

---

## 22. Recommended MVP Default

The default preset should be **Balanced Wheel**.

Reason:

- Conservative Wheel may feel too restrictive or sparse.
- Aggressive Yield may surface exciting names but can teach bad habits if defaulted.
- Balanced Wheel best reflects disciplined premium selling: income with risk control.

Default MVP settings:

- Strategy: Balanced Wheel.
- DTE: 21–30.
- Delta target: ~0.20.
- Minimum premium yield: >= 1%.
- Show both short puts and covered calls.
- Warn on earnings before expiration.
- Penalize wide spreads.
- Penalize weak trend for short puts.
- Penalize calls that cap upside too tightly in strong bullish trends.

---

## 23. Final Product Principle

The product should help users behave like disciplined premium sellers, not gamblers sorting for the highest yield.

A good wheel dashboard does not simply ask:

> Which option pays the most?

It asks:

> Which option pays enough, has acceptable liquidity, fits the selected risk profile, and does not create avoidable assignment or event risk?

That is the business requirement.
