# Phase 7 — Executive Dashboard & KPI Scorecards

A pure composition layer unifying Actuals (Finance Engine), Budget, Scenario, Forecast, and Investment Analysis into one executive experience. Per the phase brief's own framing, this phase is about **visibility and decision support, not new business logic** — with one deliberate exception (the Business Health Score, a genuinely new calculation, exactly as NPV/IRR were new in Phase 6 and the regression/seasonal models were new in Phase 5).

## Features Added

1. **Executive Overview** — 17 KPIs (Revenue, Orders, AOV, Gross Profit, Gross Margin, EBITDA, EBITDA %, Net Profit, Food Cost %, Labour Cost %, Prime Cost %, Customer Growth %, Repeat Customer %, Branch Count, Active Employees, Inventory Value, Cash Position), filterable by Restaurant/Branch/Date Range.
2. **Configurable KPI Scorecards** — the 7 KPIs with a Budget and Forecast equivalent, each showing Current/Target/Previous Period/Budget/Forecast/Achievement %/Trend/Status.
3. **Business Health Score (0-100)** — a weighted average across 10 categories (Revenue Achievement, EBITDA, Net Profit, Food Cost, Labour Cost, Prime Cost, Forecast Accuracy, Budget Achievement, Customer Growth, Branch Performance), with category scores, Excellent/Good/Warning/Critical status, and improvement suggestions. Weights are a plain configuration object, not hardcoded into the math.
4. **Multi-Branch Executive View** — every branch ranked by Revenue/Profit/EBITDA/Food Cost/Labour/Budget Achievement/ROI/Health Score, with Best Performing/Most Improved/Highest Risk/Lowest Performing highlighted.
5. **Executive Timeline** — Revenue/Profit/EBITDA trend, Budget Achievement trend, Forecast trend (from persisted snapshots), and an Investment timeline, at Daily/Weekly/Monthly/Quarterly/Yearly granularity.
6. **Executive Alert Center** — Revenue below target, Food Cost increasing, Labour Cost increasing, EBITDA falling, Forecast confidence low, Budget variance critical, Investment ROI below expectation, Branch underperforming, Forecasted cash-flow risk — each with severity, impact, recommended action, and a link to the relevant screen.
7. **Executive Insight Panels** — Actual vs Budget, Forecast Summary, Scenario Summary, Investment Portfolio Summary, Top Opportunities, Top Risks — each a thin pass-through of an existing engine's own output.
8. **Dashboard Customisation** — pin/unpin KPI cards, reorder them, and set a default period, persisted per user.
9. **7 report types**, each exportable as PDF/Excel/CSV/Print.

## Dashboard Architecture

Every function in `executive.service.ts` is a **composition**, not a calculation:

| Executive feature | Reused engine call |
|---|---|
| Revenue/EBITDA/Food Cost/Labour/Prime Cost | `resolveScopedMetrics` (Finance Engine, Phase 4) |
| Customer Growth / Repeat Customer % | `getBranchComparisonService` (existing analytics module) |
| Budget column / Budget Achievement | `getBudgetVarianceService` (Budget Engine, Phase 3) |
| Forecast column / Forecast Accuracy / Forecast Trend | `generateForecastService` / `getForecastAccuracyReportService` (Forecast Engine, Phase 5) |
| Scenario Summary | `listScenariosService` (Scenario Engine, Phase 4) |
| Investment Portfolio / ROI / Top Opportunities-Risks | `getPortfolioSummaryService` / `rankBranchInvestmentsService` (Investment Engine, Phase 6) |
| Achievement %, variance, trend | `computeAchievement` / `computeVariance` (`finance.formulas.ts`/`finance.ratios.ts`, unmodified) |

The only new math is `executive.formulas.ts`'s Business Health Score — a plain weighted average of already-computed achievement percentages, with no financial formula re-derived anywhere.

**Call graph note (no duplicate work, no infinite recursion):** `getBusinessHealthScoreService(branchId=null)` (restaurant-wide) calls `getMultiBranchExecutiveViewService`, which calls `getBusinessHealthScoreService(branchId=X)` once per real branch — each of those calls has a non-null `branchId` and therefore never recurses further (its own Branch Performance category is `no-data`, redistributed). This is a single well-defined two-level call structure, not a loop.

## KPI Definitions

| KPI | Source | Unit |
|---|---|---|
| Revenue, Gross Profit, Gross Margin %, EBITDA, EBITDA %, Net Profit, Food Cost %, Labour Cost %, Prime Cost %, Orders, AOV | `resolveScopedMetrics(...).metrics` | currency/percentage/count |
| Customer Growth % | `(thisPeriodCustomers − previousPeriodCustomers) / previousPeriodCustomers × 100`, both period counts from `getBranchComparisonService` | percentage |
| Repeat Customer % | `getBranchComparisonService`'s own `repeatCustomerRate`, summed across branches in scope | percentage |
| Branch Count | `prisma.branch.count({ isActive: true, isDeleted: false })` | count |
| Active Employees | `prisma.user.count({ isActive: true, isDeleted: false })`, scoped by branch when requested | count |
| Inventory Value | `Σ(ingredient.quantity × ingredient.pricePerUnit)` — restaurant-wide only, disclosed below | currency |
| Cash Position | Most recent `DailyCashSession`'s `closingCash` (if closed) or `expectedCash` (if still open), summed per branch in scope | currency |

Targets resolve two-tier (branch override → restaurant default → native source) exactly like `FinancialAssumptions`/`FinancialScenario`: an explicit `ExecutiveKpiTarget` row always wins; otherwise the KPI's native target field is used where one exists (`FinancialAssumptions.foodCostTargetPercentage`, `RestaurantInsights.monthlyRevenueGoal`, etc.), else `null` ("no-data" status, not a fabricated 0).

## Business Health Score Methodology

Weighted average of 10 category scores (each an achievement-style percentage, clamped to 0-100):

```
revenueAchievement 0.15   ebitda 0.15   netProfit 0.10   foodCost 0.15   labourCost 0.10
primeCost 0.10   forecastAccuracy 0.05   budgetAchievement 0.10   customerGrowth 0.05   branchPerformance 0.05
```

- **Missing data is redistributed, never treated as 0.** If a category has no data yet (e.g. no published Budget), its weight is redistributed proportionally across the categories that *do* have data — a restaurant that hasn't set up Budgets isn't penalized as if it were performing badly at budgeting.
- **Customer Growth** uses a documented linear transform: `score = 50 + growthPercentage` (0% growth reads as a neutral 50; ±50% growth saturates the 0-100 range).
- **Status bands**: ≥85 Excellent, ≥70 Good, ≥50 Warning, else Critical — the same thresholds used for every individual KPI Scorecard's status, for one consistent vocabulary across the whole dashboard.
- **Improvement suggestions**: the up-to-5 lowest-scoring categories (below 70), worst first, each mapped to a one-line, category-specific suggestion.

## Reports Added

Executive Summary, CEO Dashboard (Overview + Health Score combined), Multi-Branch Performance, KPI Scorecard, Executive Trend, Business Health, Executive Risk — all via the same `jsPDF`/`ExcelJS`/`file-saver` export pattern established in Phases 2-6.

## Charts Added

`ExecutiveCharts.tsx` — Revenue/Profit/EBITDA Trend, Budget Achievement Trend, Branch Performance Ranking, Investment Portfolio Performance (NPV), Forecast Trend, and a Revenue Heat Map (a colored CSS grid — recharts has no native heat map, matching the same practical-interpretation precedent already used for Investment's "waterfall" in Phase 6).

## APIs Added

All under `/api/executive`, mirroring every prior phase's auth/ownership pattern (`authMiddleware` + `requireOwnRestaurant()`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/:restaurantId/overview` | 17-KPI Executive Overview |
| GET | `/:restaurantId/scorecards` | Configurable KPI Scorecards |
| GET | `/:restaurantId/health-score` | Business Health Score |
| GET | `/:restaurantId/multi-branch` | Multi-Branch Executive View |
| GET | `/:restaurantId/timeline` | Executive Timeline (`?granularity=`) |
| GET | `/:restaurantId/alerts` | Executive Alert Center |
| GET | `/:restaurantId/insight-panels` | Executive Insight Panels |
| GET/PUT/DELETE | `/:restaurantId/kpi-targets[/:kpiKey]` | KPI target customization |
| GET/PUT | `/:restaurantId/preferences` | Per-user dashboard layout (always the *authenticated* user, never a client-supplied id) |

## UI Screens Added

`owner-web/src/pages/executive/` — 5 tabs under `/dashboard/executive`: Overview (health score, alerts, customizable pinned KPI cards, full KPI table), Scorecards, Multi-Branch (ranking + insight panels + charts), Timeline (trend charts + heat map + investment timeline), Reports.

## Database Changes

Two new tables, additive only:

```prisma
model ExecutiveKpiTarget {
  id Int @id @default(autoincrement())
  restaurantId Int
  branchId     Int?
  kpiKey       String
  targetValue  Float
  updatedById  Int?
  @@unique([restaurantId, branchId, kpiKey])
}

model UserDashboardPreference {
  id Int @id @default(autoincrement())
  userId       Int @unique
  restaurantId Int
  layout        Json?
  pinnedKpis    Json?
  defaultPeriod String?
  defaultBranchId Int?
}
```

**Migration**: `prisma/migrations/20260728030000_add_executive_dashboard/migration.sql` — applied via `prisma migrate deploy`.

**Design decision — no `InvestmentScenario`-style duplication here either.** `ExecutiveKpiTarget` is the *only* new persisted concept; Business Health Score, Alerts, Branch Rankings, and Timelines are all computed on read, matching the established "don't persist a projection" precedent from Scenario (Phase 4) and Forecast's historical-series-by-repeated-computation pattern (Phase 5).

**A note on `RestaurantInsights.initialInvestment` / prior phases' dormant fields**: unrelated to this phase; no changes were needed or made to any existing table.

## Tests Added

- **`executive.formulas.test.ts`** (15 tests, unit) — `clampScore`/`statusForScore` boundaries, weight redistribution when a category has no data (with an explicit check that it does *not* default to treating null as 0), the all-null fallback, score clamping above 100, and suggestion generation/ordering/capping.
- **`executive.integration.test.ts`** (11 tests, real DB) — Overview KPIs matching hand-computed actuals (including Branch Count/Active Employees/Inventory Value), two-tier KPI target resolution (default → override → fallback-after-delete), Scorecards' Budget/Forecast columns, Health Score's redistribution behavior (single-branch vs restaurant-wide), Multi-Branch ranking, Timeline's 12-point monthly series, Alert shape validation, Insight Panel composition, and dashboard preference save/reload.
- Result: unit suite grew from 182 → 197 tests; integration suite grew from 36 → 47 tests. All passing (one transient DB connection-pool timeout was observed and resolved on re-run — a pre-existing test flake unrelated to this phase's code, not a regression).
- **Live-DB verification scripts**: 31 backend assertions (hand-computed KPI values, target override precedence, health score structure, ranking, timeline, alerts, preferences) and 17 Playwright browser assertions across all 5 UI tabs — all passing, all test data cleaned up.

## Performance

- No new duplicate calculations or DB access patterns. Every Overview/Scorecard/Health Score/Alert call reuses the exact same engine functions every other phase already calls — no parallel query path was written for anything Finance/Budget/Forecast/Investment already computes.
- `getMultiBranchExecutiveViewService` fetches the Investment ranking **once** (not once per branch inside the loop) — an N+1 was caught and fixed during design (see Design Decisions) before it ever shipped.
- Budget Achievement is only looked up for branches that actually have a published budget (a second, targeted pass after the primary per-branch `Promise.all`, not a blocking lookup inside it) — most branches in a real deployment won't have one yet, so this avoids blocking the whole view on a mostly-empty lookup.
- `getExecutiveTimelineService` reuses the exact same "repeated `resolveScopedMetrics` calls in parallel across historical periods" pattern already accepted in Phase 5's Forecast Engine and Phase 3's Budget trend charts — the same documented tradeoff (no dedicated aggregation endpoint without evidence of a real bottleneck).
- Forecast Trend reuses already-*persisted* `FinancialForecast` snapshots (Phase 5) — never recomputes a historical forecast.

## Files Modified / Added

**Backend:**
- `prisma/schema.prisma`, `prisma/migrations/20260728030000_add_executive_dashboard/migration.sql` (new)
- `src/modules/executive/` (new) — `executive.types.ts`, `executive.formulas.ts`, `executive.validation.ts`, `executive.service.ts`, `executive.controller.ts`, `executive.routes.ts`, `executive.formulas.test.ts`, `executive.integration.test.ts`
- `src/routes/index.ts` — registered `/api/executive`

**Frontend:**
- `src/pages/executive/` (new) — `ExecutiveDashboard.tsx`, `OverviewTab.tsx`, `ScorecardsTab.tsx`, `MultiBranchTab.tsx`, `TimelineTab.tsx`, `ReportsTab.tsx`, `ExecutiveCharts.tsx`, `executiveCategories.ts`
- `src/routes/AppRoutes.tsx`, `src/layouts/DashboardLayout.tsx` — route + nav entry

## Design Decisions

1. **Dashboard preferences are always scoped to the authenticated caller, never a client-supplied `userId`.** The route is mounted under `/:restaurantId/preferences` (for `requireOwnRestaurant`'s tenant check and consistency with every other route), but the controller reads/writes exclusively via `(req as any).user.id` from the verified JWT — a user can never read or overwrite another user's layout by editing a URL parameter.
2. **"Rearrange widgets" is implemented as up/down reordering buttons, not drag-and-drop.** No drag library exists anywhere in this project; adding one for a single feature would be a disproportionate new dependency for what a simple, fully keyboard-accessible reorder control already achieves.
3. **Inventory Value is reported restaurant-wide even when a branch scope is requested.** `Ingredient` has no `branchId` column anywhere in the schema — there is no way to split stock value per branch without inventing a new data model this phase wasn't asked to build. Disclosed here rather than silently fabricating a per-branch split.
4. **Cash Position is a best-effort definition, not a true ledger balance**: the most recent `DailyCashSession`'s closing balance (or live expected balance, if the session is still open), summed per branch. The spec itself flagged this KPI as "if available" — no cash-ledger concept existed anywhere before this phase; this is the closest honest reading of the data that does exist (`DailyCashSession`), not a new accounting system.
5. **An N+1 was caught and fixed before shipping**: the first draft of `getMultiBranchExecutiveViewService` called `rankBranchInvestmentsService` (which already returns every branch) once *per branch* inside the ranking loop. Fixed to call it once, hoisted out of the loop, before writing any tests against it.
6. **No Redux slice / RTK Query / MUI / form library for the new UI** — consistent with all six prior phases' established convention.

## Final Validation

- ✅ Backend builds (`npm run build`, `prisma generate && tsc`) — clean.
- ✅ Frontend builds (`npm run build`, `vite build`) — clean, no new warnings beyond the pre-existing single-large-chunk warning.
- ✅ All 197 unit tests pass (`npm test`); all 47 integration tests pass (`npm run test:integration`).
- ✅ 31/31 live-DB backend assertions pass, including hand-computed KPI values (Revenue, Orders, Food Cost %, Repeat Customer %, Branch Count, Active Employees, Inventory Value, Cash Position), two-tier target resolution, and Health Score redistribution behavior.
- ✅ 17/17 Playwright browser assertions pass across all 5 Executive Dashboard tabs — zero Executive-specific console errors (the same pre-existing, unrelated public-marketing-page hydration warning noted in Phases 4-6 was observed again and remains out of scope).
- ✅ Manually verified the Business Health Score with constructed sample data — confirmed weight redistribution behaves correctly (a missing category never silently counts as a 0) and that the overall score stays within 0-100 in every case, including the all-data-missing edge case.
- ✅ Confirmed every KPI, alert, and ranking traces back to an existing Finance/Budget/Scenario/Forecast/Investment engine call — the Business Health Score formula is the only new calculation anywhere in this module.
- ✅ No duplicate financial calculations anywhere in the new code.
