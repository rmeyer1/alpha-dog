# US Equities Market Calendar

Alpha Dog uses a committed US equities session calendar so cron gates, option
DTE, freshness suggestions, and the screener UI do not depend on a live
provider call. The authoritative runtime data is
`src/lib/market/us-equities-calendar.json`; the Alpha Dog maintainers own its
accuracy and annual refresh.

## Runtime contract

- Coverage is explicit and fail-closed. Dates outside the maintained horizon
  are never reported as open.
- Core sessions are 9:30 a.m.–4:00 p.m. in `America/New_York`. The calendar
  records holidays, exceptional closures, and 1:00 p.m. equity early closes.
- `Intl.DateTimeFormat` resolves New York civil time. No fixed UTC offset is
  stored, so EST and EDT retain the same exchange-local boundaries.
- Deep-scan coverage may begin at 8:00 a.m. on a session day but stops at that
  day's equity close. The screener refresh gate runs only during the core
  session or the 4:00–6:00 p.m. prewarm window on the final closed day before
  the next session. This skips premature work earlier in a three-day weekend.
- Equity and ETF option DTE uses the applicable equity core-session close on
  or before the provider's contract date. This is a valuation boundary, not a
  claim about every product's last trade. Product-specific 4:15 p.m. ETF/index
  option exceptions and AM-settled index options are outside the app's current
  contract model.

## Sources

- [NYSE Holidays & Trading Hours](https://www.nyse.com/trade/hours-calendars)
  is authoritative for the published 2026–2028 holidays, 9:30 a.m.–4:00 p.m.
  core session, and 1:00 p.m. equity early closes.
- [NYSE 2026 Yearly Trading Calendar](https://www.nyse.com/publicdocs/nyse/ICE_NYSE_2026_Yearly_Trading_Calendar.pdf)
  is the exchange-owned annual cross-check.
- [Alpaca Market Calendar](https://docs.alpaca.markets/us/v1.4.2/reference/querymarketcalendar)
  confirms that provider calendar rows expose market dates and exact open/close
  times, including early closures.

## Annual update

Complete this process by October 1, and whenever an exchange announces an
exceptional closure:

1. Open the NYSE holiday page and yearly trading calendar. Add the next
   published year to the JSON coverage, holidays, and early closes.
2. Cross-check sample normal, holiday, and early-close rows against Alpaca's
   calendar response. Do not make Alpaca a runtime dependency.
3. Record any unscheduled closure in `exceptionalClosures`, update
   `verifiedAt`, and retain the source URL.
4. Run `npm run verify:market-calendar` and the full test suite. The verifier
   fails when fewer than 365 maintained future days remain.
5. Review the table-driven calendar, DTE, cron-route, freshness, and UI-status
   tests before merging.
