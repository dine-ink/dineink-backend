# Phase 5 — Forecasting & Predictive Analytics

Predicts future business performance from a restaurant's own historical financial data. Forecasts are predictions only — no forecast code path writes to `Order`, `Bill`, `RestaurantInsights`, `Budget`, `FinancialScenario`, or any financial-statement table. The one thing this phase *does* persist — a frozen snapshot of what was predicted — is a deliberate, spec-mandated exception explained in Design Decisions §1, not a departure from that rule.

## Features Added

1. **Forecast Engine** — predicts Revenue, Orders, Average Order Value, Food Cost, Labour Cost, Rent, Utilities, Operating Expenses, Gross Profit (₹+%), EBITDA (₹+%), Net Profit, Break-even Sales/Orders, Contribution Margin, Margin of Safety, and Cash Flow (reserved — see §5) for Next Week, Next Month, Next Quarter, Next 6 Months, or Next Year.
2. **3 forecast models** — Historical Trend (linear regression), Moving Average (last-3-period rolling average), Seasonal (naive same-period-last-year × average YoY growth, monthly only, needs ≥13 months of history). A requested model that the available history can't support downgrades automatically with a human-readable reason (e.g. "Seasonal forecasting needs at least 13 months of history (have 3) — falling back to Historical Trend").
3. **Confidence scoring** — High/Medium/Low per forecast, with explicit reasons (insufficient history, high volatility, missing/zero-activity periods, limited history, forced model downgrade) rather than a bare badge.
4. **Forecasting dashboard** — scope (branch/restaurant-wide) + period + model selectors, confidence badge with an expandable "why" list, an Upcoming Risks/Alerts panel, 6 headline KPI cards, a full KPI table, and charts.
5. **Forecast vs Actual** — once a forecasted period's end date has passed, the frozen prediction is automatically compared against the real actual (computed live from the Finance Engine, never stored) — Variance, Variance %, and Accuracy %. Before the period completes, the same row structure is shown with `actual: null` rather than fabricating a number.
6. **Forecast Accuracy Report** — averages Accuracy % per KPI across every completed forecast for a scope, so an owner can see how reliable forecasts have actually been over time.
7. **Forecast charts** — Revenue/Profit/EBITDA/Food Cost/Labour/Expense/Cash Flow Forecast (Last Period vs Forecast), plus a Variance %-by-KPI summary chart, each switchable between Line/Bar/Area.
8. **Branch Forecasting** — forecast the entire restaurant, an individual branch, or rank every branch by expected Revenue/Profit/EBITDA/Growth %.
9. **Forecast Alerts** — Expected revenue decline, Food cost likely to exceed target, Profit margin (EBITDA %) expected to decrease, Labour cost increasing, Break-even may not be achieved, Sales trending upward — all derived from already-computed KPI rows (variance/trend/achievement), no new formulas.
10. **Reports** — Forecast Summary, Revenue Forecast, Profit Forecast, Branch Forecast, Forecast Accuracy, each exportable as PDF/Excel/CSV/Print.

## Database Changes

One new table, additive only — no existing table altered.

```prisma
enum ForecastPeriodType { NEXT_WEEK NEXT_MONTH NEXT_QUARTER NEXT_6_MONTHS NEXT_YEAR }
enum ForecastModelType { HISTORICAL_TREND MOVING_AVERAGE SEASONAL }

model FinancialForecast {
  id              Int                @id @default(autoincrement())
  restaurantId    Int
  branchId        Int?               // null = restaurant-wide
  periodType      ForecastPeriodType
  model           ForecastModelType
  targetStartDate DateTime
  targetEndDate   DateTime
  predictions     Json               // frozen ForecastKpiPrediction[] — see Design Decisions §1
  createdById     Int?
  createdAt       DateTime @default(now())

  restaurant Restaurant @relation(...)
  branch     Branch?    @relation(...)
  createdBy  User?      @relation("FinancialForecastCreatedBy", ...)

  @@index([restaurantId])
  @@index([branchId])
  @@index([restaurantId, periodType])
  @@index([targetEndDate])
}
```

`predictions` is a `Json` column — already an established pattern in this schema (`InventoryRestock.data`), used here because the field set is a per-KPI array, not a bounded flat set of independent columns (unlike `FinancialScenario`/`FinancialAssumptions`, which have a fixed field list and used individual `Float?` columns instead).

**Migration**: `prisma/migrations/20260728010000_add_financial_forecast/migration.sql` — hand-written, additive-only (`CREATE TYPE` ×2, `CREATE TABLE`, 4 indexes, 3 foreign keys: `restaurantId`/`branchId` → `RESTRICT`, `createdById` → `SET NULL`, mirroring `FinancialScenario`'s exact FK conventions). Applied via `prisma migrate deploy` against the production RDS instance.

**One additive change to `dateRange.ts`**: `startOfDay`/`endOfDay`/`startOfWeek`/`endOfWeek`/`startOfMonth`/`endOfMonth`/`startOfQuarter`/`endOfQuarter`/`startOfYear`/`endOfYear` were made `export`ed (previously private to that file) so the Forecast Engine's "next period" resolution (which has no current/previous equivalent in `resolveDateRange`) could reuse the exact same calendar-boundary logic instead of re-deriving it. No existing behavior changed — pure visibility change, confirmed by the full pre-existing test suite still passing unchanged.

## APIs Added

All under `/api/forecasts`, mirroring `scenario.routes.ts`'s exact auth/ownership pattern (`authMiddleware` + `requireOwnRestaurant()` on `:restaurantId`; per-forecast ownership checked in the service layer):

| Method | Path | Purpose |
|---|---|---|
| GET | `/:restaurantId/generate` | Generate a live forecast (`?branchId=&period=&model=`) — also persists an idempotent snapshot as a side effect |
| GET | `/:restaurantId/accuracy` | Forecast Accuracy Report for a scope (`?branchId=`) |
| GET | `/:restaurantId/branch-ranking` | Rank every branch by expected Revenue/Profit/EBITDA/Growth (`?period=&model=`) |
| GET | `/:restaurantId` | List saved snapshots (`?branchId=&period=`) |
| GET | `/:restaurantId/:forecastId` | Get one saved snapshot |
| GET | `/:restaurantId/:forecastId/vs-actual` | Forecast vs Actual comparison for one snapshot |

## UI Screens Added

`owner-web/src/pages/forecast/` — 4 tabs under a new `/dashboard/forecasting` route, structurally identical to Budget/Scenario's shell/tab pattern:

- **Overview** — scope/period/model selectors, confidence badge + "why" explanation, Upcoming Risks alert panel, 6 KPI cards, charts, full KPI table.
- **Branch Comparison** — ranked table (🏆 top branch) by expected Revenue/Profit/EBITDA/Growth %, with a confidence badge per branch.
- **Accuracy** — aggregate accuracy summary across all completed forecasts, a forecast-history list, and the selected snapshot's full Forecast vs Actual table.
- **Reports** — 5 report types, PDF/Excel/CSV/Print export.

No new shared/global UI components were introduced — every piece (KPI card styling, confidence/alert color conventions, period-pill/select patterns, chart mode switcher, export handlers) reuses the exact structural patterns already established in `pages/budget/*` and `pages/scenario/*`.

## Dashboard Changes

- New sidebar nav entry "Forecasting" (`PresentationChartLineIcon`) in `DashboardLayout.tsx`, directly after "Scenario Analysis".
- New route `forecasting` registered in `AppRoutes.tsx` under the existing `/dashboard` layout.

## Forecast Models Implemented

- **Historical Trend** — ordinary least-squares linear regression over the whole available history, extrapolated forward; floors at 0 (no series here can go negative).
- **Moving Average** — flat continuation of the average of the last 3 periods (or the whole series if shorter).
- **Seasonal** — naive "same calendar month one year ago × average year-over-year growth ratio observed across the series"; requires ≥13 monthly points, monthly granularity only. Automatically downgrades to Historical Trend (or Moving Average, if fewer than 2 points exist) otherwise.
- **Extensibility**: every model is a plain `(values, horizon) => number[]` function registered in `runForecastModel`/`resolveEffectiveModel` (`forecast.formulas.ts`) — a future ML-based model (e.g. Prophet/ARIMA/a hosted model API) just needs to fit that same shape; nothing else in the module changes.

## Reports Added

Forecast Summary Report, Revenue Forecast Report, Profit Forecast Report, Branch Forecast Report, Forecast Accuracy Report — the first three reuse the single `/generate` endpoint filtered to different KPI subsets client-side; Branch/Accuracy reuse `/branch-ranking` and `/accuracy` respectively. All exportable as PDF/Excel/CSV/Print via the same `jsPDF`/`ExcelJS`/`file-saver` pattern established in Phase 2/3/4.

## Charts Added

`ForecastCharts.tsx` — a Variance %-by-KPI summary chart (colored green/red, matching Budget/Scenario's own variance charts), plus Last-Period-vs-Forecast cards for Revenue/Profit/EBITDA/Food Cost/Labour/Operating Expenses/Cash Flow, each with a Line/Bar/Area mode toggle.

## Tests Added

- **`forecast.formulas.test.ts`** (29 tests, unit) — `linearRegression`, `forecastTrend`, `forecastMovingAverage`, `forecastSeasonal`, `computeConfidence`'s High/Medium/Low thresholds and reason generation, `resolveEffectiveModel`'s every downgrade path, `forecastSeries`'s aggregation, `combineConfidence`'s weakest-link logic.
- **`forecast.integration.test.ts`** (9 tests, real DB) — end-to-end forecast generation from a hand-computable 3-month linear trend (matching the exact regression arithmetic worked out below), alert firing, model downgrade, snapshot persistence/idempotency, both Forecast-vs-Actual paths (incomplete and completed), accuracy aggregation, branch ranking (with a check that ranking does *not* create extra snapshots), and restaurant-wide multi-branch aggregation.
- Result: unit suite grew from 129 → 158 tests; integration suite grew from 17 → 26 tests. All passing.
- **Live-DB verification scripts**: 36 backend assertions (mirroring the integration tests plus live snapshot/idempotency/downgrade checks against the running dev server) and 16 Playwright browser assertions across all 4 UI tabs — all passing, all test data cleaned up.

### Worked example (used throughout the tests above)

Branch A: April 5 bills, May 7, June 9 (all ₹200, 20 recipe cost each) — orders `[5,7,9]` and revenue `[1000,1400,1800]` are both perfectly linear by construction.
- Orders regression: slope 2, intercept 5 → Next Month (index 3) predicted = 5 + 2×3 = **11**.
- Revenue regression: slope 400, intercept 1000 → predicted = 1000 + 400×3 = **2200**.
- Food cost (20/order, same linear shape): predicted = **220** → foodCostPercentage = 220/2200 = **10%**, unchanged from history.
- No labour/rent/utilities/finance-cost data anywhere in the fixture → all predicted at **0** (a flat, honest "no data to forecast from," not a fabricated number).
- EBITDA = 2200 − 220 − 0 − 0 − 0 = **1980** (90%); Net Profit = **1980**; Break-even Revenue = **0** (no fixed/labour/finance cost to break even against).
- Confidence: 3 data points → capped at **Medium** regardless of stability (High requires ≥6).

## Performance

- No new duplicate calculations or DB access patterns. Every historical period's snapshot is built via `resolveScopedMetrics`/`fetchInsightsForScope`/`getMenuItemCostMap` — the *same* functions Budget and Scenario already share — fetched once per request (`insightsData`, `menuItemCostMap`, resolved `FinancialAssumptions`) and reused across every historical period queried.
- **Lookback capping**: historical queries are capped not just at a hard ceiling (16 weeks / 24 months) but at how long the scope has actually existed (`maxCompletePeriodsSince`, using `restaurant.createdAt`/`branch.createdAt`) — a brand-new branch doesn't fire wasted queries for months before it opened.
- Historical periods are fetched in parallel via `Promise.all` — the same accepted tradeoff already documented in Phase 3 (Budget's 12-parallel-month trend charts): reusing the existing engine with no dedicated aggregation endpoint, rather than optimizing prematurely without evidence of a real bottleneck.
- Branch ranking calls `generateForecastService` per branch with `persist: false` specifically so that viewing a ranking page never silently multiplies stored snapshots — only the single-scope forecast view accumulates history for accuracy tracking.
- The Forecast Accuracy Report is bounded (`take: 50` most-recent completed forecasts) — a growing forecast history over years doesn't make the report unbounded.

## Files Modified / Added

**Backend:**
- `prisma/schema.prisma`, `prisma/migrations/20260728010000_add_financial_forecast/migration.sql` (new)
- `src/utils/dateRange.ts` — exported the previously-private calendar-boundary helpers
- `src/modules/forecast/` (new) — `forecast.types.ts`, `forecast.formulas.ts`, `forecast.validation.ts`, `forecast.service.ts`, `forecast.controller.ts`, `forecast.routes.ts`, `forecast.formulas.test.ts`, `forecast.integration.test.ts`
- `src/routes/index.ts` — registered `/api/forecasts`

**Frontend:**
- `src/pages/forecast/` (new) — `Forecasting.tsx`, `OverviewTab.tsx`, `BranchComparisonTab.tsx`, `AccuracyTab.tsx`, `ReportsTab.tsx`, `ForecastCharts.tsx`, `forecastCategories.ts`
- `src/routes/AppRoutes.tsx`, `src/layouts/DashboardLayout.tsx` — route + nav entry

## Design Decisions

1. **Why Forecast persists a snapshot when Scenario deliberately never does.** Scenario's "never persist a projected value" rule exists because a what-if is infinitely re-runnable and hypothetical — there is no single "correct" scenario projection to freeze. Forecasting is different by the spec's own explicit requirement (§5): "once actual data becomes available, automatically compare Forecast, Actual, Variance." That comparison is only meaningful if the *prediction itself* is frozen at the moment it was made — recomputing "what we predicted for August" in October (with September's data now folded into the trend) would silently rewrite history and make "accuracy" meaningless. So `FinancialForecast.predictions` freezes only the **prediction values**; the **actual** side of every comparison is always recomputed live from the Finance Engine, never stored — the persisted half is the minimum needed to make accuracy tracking possible, not a general-purpose "save my forecast" feature.
2. **Snapshots are created idempotently as a side effect of viewing, not via a separate "save" button.** At most one `FinancialForecast` row exists per `(restaurantId, branchId, periodType, targetStartDate)`. This means simply using the Forecasting dashboard naturally builds up forecast history for later accuracy scoring, matching the spec's own word "automatically." Branch ranking explicitly opts out (`persist: false`) so that viewing a ranking page — which generates a forecast per branch — doesn't silently flood the table with N snapshots every time someone looks at it.
3. **Forecast the raw ₹/count figures independently; derive every percentage/EBITDA/break-even figure from `computeFinancialMetrics` exactly once.** Revenue, Orders, Food Cost, Labour, Fixed/Variable Expenses, Finance Cost, Rent, and Utilities are each forecast independently from their own history (9 series). Their predicted horizon totals are summed into one aggregated `FinancialInputs` object and run through `computeFinancialMetrics` — the same formula engine every other module uses — exactly once. This guarantees Food Cost %, Prime Cost, Gross Margin, EBITDA %, Break-even, etc. are always internally consistent with each other and with the rest of the app, and that no derived-metric formula is ever duplicated for forecasting.
4. **Confidence is scored per raw series, then combined by weakest link.** Each of the 9 raw series gets its own confidence (based on its own data-point count, volatility, and activity gaps); the forecast's overall confidence — and every KPI row's displayed confidence — is the *minimum* across all 9. A derived figure like EBITDA is only as reliable as its least-reliable input; reporting per-KPI confidence independently (e.g. treating EBITDA's confidence as if it had its own separate history) would overstate reliability.
5. **Historical granularity is weekly for Next Week, monthly for everything else** (Next Month/Quarter/6 Months/Year all build on the *same* monthly series, just projecting further out and summing). A dedicated quarterly/yearly historical series was considered and rejected — most restaurants won't have enough historical quarters/years for a meaningful fit, and reusing one monthly series avoids a second, redundant history-fetch path.
6. **Cash Flow is reserved, not fabricated.** No real cash-flow data source exists anywhere in the app yet (Budget's own variance rows already report this category as `no-data`, and Scenario's KPI list does the same). Forecast follows the same honest precedent — the KPI row exists in every report/chart for forward-compatibility, but its extractor always returns `null` rather than inventing a proxy calculation.
7. **The dormant `RestaurantInsights` "Business Assumptions" fields (`expectedMonthlyGrowth`, `expectedDeliveryGrowth`, `expectedInflation`, `seasonalImpact`, `weekendSalesIncrease`, `plannedExpansion`) are deliberately still not read.** Phase 2's report flagged these as "inert placeholders for the not-yet-built Forecasting feature" and suggested consolidating them onto `FinancialAssumptions` when this phase arrived. Phase 5's spec, however, asks specifically for *historical-data-driven* forecasting (trend/moving-average/seasonal models), not a manually-entered-assumption blend — wiring these fields in now would mean inventing an unreviewed blending formula (how much weight does a manual "expected 5% growth" get against the model's own regression?) beyond what was actually requested. Left untouched and disclosed here again, rather than half-integrated, so a future phase can design that blend deliberately.
8. **No Redux slice / RTK Query / MUI / form library for the new UI** — consistent with Budget and Scenario, this app's actual established convention (local `useState` + `fetch` + `useAppSelector`) was followed rather than introducing a different data layer for one module.

## Final Validation

- ✅ Backend builds (`npm run build`, `prisma generate && tsc`) — clean.
- ✅ Frontend builds (`npm run build`, `vite build`) — clean, no new warnings beyond the pre-existing single-large-chunk warning.
- ✅ All 158 unit tests pass (`npm test`); all 26 integration tests pass (`npm run test:integration`).
- ✅ 36/36 live-DB backend assertions pass, including hand-computed regression arithmetic, model downgrade, snapshot idempotency, both Forecast-vs-Actual paths, accuracy aggregation, and branch ranking.
- ✅ 16/16 Playwright browser assertions pass across all 4 Forecasting tabs, driven against the live dev server — zero Forecast-specific console errors (one pre-existing, unrelated hydration warning on the public marketing home page's `Navbar` was observed and is out of scope for this phase, as already noted in the Phase 4 report).
- ✅ Manually verified every forecasted figure by hand against a constructed linear-trend dataset (see the worked example above) — matched exactly, including the derived EBITDA/margin/break-even figures.
- ✅ Confirmed no forecast code path writes to any live financial table — `getForecastVsActualService` recomputes "actual" fresh from `resolveScopedMetrics` on every call rather than reading a cached value, and `ensureForecastSnapshotService` only ever inserts a new `FinancialForecast` row, never updates or reads back into any other table.
- ✅ Every calculation reuses `computeFinancialMetrics`/`computeVariance` from `finance.formulas.ts` and `computeAchievement` from `finance.ratios.ts`, unmodified — the only genuinely new calculations anywhere in this module are the time-series prediction functions themselves (`forecast.formulas.ts`), which have no pre-existing equivalent anywhere in the app.
