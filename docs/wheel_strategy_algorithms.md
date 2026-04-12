# Algorithm & Mathematical Specification: Wheel Strategy Options

This document defines the mathematical formulas required to implement the calculators and the automated scoring system.

## 1. Core Option Calculators

### 1.1 Premium Yield & Annualized Return
**Inputs:** Option Premium, Strike Price, Days to Expiration (DTE).
*   **Collateral (for CSP):** $\text{Strike Price} \times 100$
*   **Collateral (for CC):** $\text{Current Stock Price} \times 100$
*   **Simple Yield:** $\frac{\text{Premium} \times 100}{\text{Collateral}}$
*   **Annualized Return:** $\text{Simple Yield} \times \left( \frac{365}{\text{DTE}} \right)$

### 1.2 Cash Secured Put (CSP) Cash Requirement
**Inputs:** Strike Price.
*   **Formula:** $\text{Strike Price} \times 100$

### 1.3 Probability of Profit (PoP) / Assignment Probability
**Inputs:** Delta.
*   **Approximation:** $\text{PoP} \approx 1 - |\text{Delta}|$
*   *Example:* A 0.30 Delta put has a $\sim 70\%$ probability of expiring out-of-the-money (profitable).

### 1.4 Cost Basis After Assignment
**Inputs:** Assignment Price (Strike), Premium Received.
*   **Formula:** $\text{Net Cost Basis} = \text{Strike Price} - \text{Premium Received}$

### 1.5 IV Rank
**Inputs:** Current IV, 52-Week High IV, 52-Week Low IV.
*   **Formula:** $\frac{\text{Current IV} - \text{Low IV}}{\text{High IV} - \text{Low IV}} \times 100$

### 1.6 Delta to PoP Converter
**Logic:** Linear mapping based on the Normal Distribution of stock price movement.

---

## 2. The "Contract Rating" (contractScore) Algorithm
Since the exact weights are proprietary, we will implement a **Weighted Multi-Factor Model**.

**Goal:** Score 0-100 based on "Ideal Wheel Characteristics."

### 2.1 Factor Weights (Proposed)
| Factor | Weight | Ideal Condition | Score Contribution |
| :--- | :--- | :--- | :--- |
| **Delta** | 30% | $0.20 \le \text{Delta} \le 0.30$ | Max points for target range; decays linearly outside. |
| **Annualized Yield** | 25% | $10\% \le \text{Yield} \le 25\%$ | Reward high yield but penalize "too high" (sign of crash). |
| **IV Rank** | 20% | $\text{IV Rank} > 50\%$ | Higher IV $\rightarrow$ higher premium $\rightarrow$ higher score. |
| **DTE** | 15% | $30 \le \text{DTE} \le 45$ | Reward "Sweet spot" of theta decay. |
| **Liquidity** | 10% | $\text{Vol} > 500 \text{ and } \text{OI} > 1000$ | Binary or tiered score for tradability. |

**Total Score Calculation:**
$$\text{Score} = \sum (\text{Factor Score} \times \text{Weight})$$

---

## 3. Filter Logic Specifications

### 3.1 "Exclude Earnings" Filter
*   **Logic:** If `currentDate + DTE` falls within $\pm 7$ days of the company's next scheduled earnings report $\rightarrow$ `exclude = true`.

### 3.2 "Only Liquid Contracts" Filter
*   **Logic:** $\text{Open Interest} > 100$ AND $\text{Bid-Ask Spread} < 5\%$ of option price.
