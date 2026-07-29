# Phase 4 — Scenario Analysis

Planning tool that lets a restaurant owner simulate different business situations — a revenue push, a labour hike, a rent increase — without touching a single Order, Inventory record, Expense, Budget, or Financial Statement. Every projected number is computed on demand by the same Finance Engine every other module uses, and nothing computed is ever persisted; only the scenario's override *definition* is saved.

## Features Added

1. **Scenario CRUD** — create, list, get, update, clone, delete, and reset-individual-fields-to-default, scoped to a restaurant or a specific branch.
2. **Built-in scenarios** — Conservative (-5% revenue/orders), Expected (no overrides — today's run rate), Optimistic (+10% revenue/orders), auto-created the first time a scope is listed, idempotently (a second list call creates nothing new). Unlimited Custom scenarios on top.
3. **20 overridable assumption fields**, every one inheriting from the resolved Financial Assumptions (restaurant default + branch override) when left blank: Revenue Growth %, Order Growth %, Average Order Value, Rent, Utilities, Marketing, Maintenance, Packaging, Food Cost Target %, Labour Target %, Delivery %, Swiggy/Zomato Commission %, Royalty %, Franchise Fee %, Salary Increment %, Inflation %, Rent Escalation %, Working Days, Business Hours.
4. **What-If Engine** — reconstructs baseline `FinancialInputs` from real actuals, applies the scenario's overrides (documented precedence below), and calls the *exact same* `computeFinancialMetrics` every other module calls. Zero duplicate formula logic. Supports live (unsaved) override deltas for instant slider-driven recalculation.
5. **21 projected KPIs**, each with Baseline (Actual), Projected, Variance, Variance %, Achievement %, and Trend: Revenue, Orders, AOV, Food Cost (₹+%), Prime Cost (₹+%), Labour (₹+%), Rent, Utilities, Operating Expenses, Gross Profit (₹+%), EBITDA (₹+%), Net Profit, Break-even Sales, Break-even Orders, Contribution Margin, Margin of Safety, Cash Flow (reserved — not yet a real data source, matching Budget's own "no-data" precedent).
6. **Comparison Mode** — Actual vs Budget (reusing the Budget module's own variance endpoint) vs any number of scenarios simultaneously, with per-cell highlighting of improvements/declines.
7. **Scenario Analysis dashboard** — scenario selector, period selector, interactive What-If sliders, 6 headline KPI cards, full KPI table, charts.
8. **Interactive What-If controls** — range sliders for the 5 highest-impact levers (Revenue Growth, Order Growth, Food Cost Target, Labour Target, Rent) plus editable number inputs for the remaining 15 fields, all debounced (350ms) so results refresh without a page reload.
9. **Charts** — Variance % by KPI, plus Baseline-vs-Projected cards for Revenue/Operating Expenses/Net Profit/EBITDA/Food Cost/Labour/Cash Flow/Break-even, each switchable between Line/Bar/Area/Stacked Bar.
10. **Branch Comparison** — applies one scenario's assumptions across every branch's own real actuals (e.g. "what if every branch grew revenue by 10%"), ranked by average Achievement % across Revenue/Net Profit/EBITDA/Food Cost/Prime Cost/Labour.
11. **Reports** — Scenario Summary, Scenario Comparison, Branch Scenario Report, Restaurant Scenario Report, each exportable to PDF/Excel/CSV/Print.
12. **Isolation guarantee** — no scenario code path ever writes to `Order`, `Bill`, `RestaurantInsights`, `Budget`, or any financial-statement table; the What-If Engine's output is a plain object returned to the caller and discarded after the response is sent.

## Database Changes

One new table, additive only — no existing table altered.

```prisma
enum ScenarioType {
  CONSERVATIVE
  EXPECTED
  OPTIMISTIC
  CUSTOM
}

model FinancialScenario {
  id           Int          @id @default(autoincrement())
  restaurantId Int
  branchId     Int?         // null = restaurant-wide
  name         String
  description  String?
  type         ScenarioType @default(CUSTOM)
  isActive     Boolean      @default(true)

  // 20 nullable override fields — null means "inherit" (see below)
  revenueGrowthPercentage, orderGrowthPercentage, avgOrderValue Float?
  rent, utilities, marketing, maintenance, packaging            Float?
  foodCostTargetPercentage, labourTargetPercentage,
  deliveryPercentage, swiggyCommissionPercentage,
  zomatoCommissionPercentage, royaltyPercentage,
  franchiseFeePercentage, salaryIncrementPercentage,
  inflationPercentage, rentEscalationPercentage                Float?
  workingDays Int?
  businessHours Float?

  createdById, updatedById Int?
  createdAt, updatedAt DateTime

  restaurant Restaurant @relation(...)
  branch     Branch?    @relation(...)
  createdBy, updatedBy User? @relation(...)

  @@index([restaurantId])
  @@index([branchId])
  @@index([restaurantId, type])
}
```

**Design decision — one flat row per scenario, not a key-value child table.** Mirrors `FinancialAssumptions`'s established pattern: the override field set is fixed and non-repeating (unlike Budget's month × category grid, which genuinely needed a `BudgetItem` child table). A generic `FinancialScenarioAssumption` table was considered and rejected — it would add a join for every read with no corresponding benefit.

**Design decision — no `ScenarioVersion` model.** "Duplicate"/"Clone" is implemented as creating a new row with copied values, exactly like Budget's `duplicateBudgetService`. A separate version-history model wasn't requested and would be unused scaffolding.

**Migration**: `prisma/migrations/20260727010000_add_financial_scenario/migration.sql` — hand-written, additive-only (`CREATE TYPE`, `CREATE TABLE`, 3 indexes, 4 foreign keys: `restaurantId`/`branchId` → `RESTRICT`, `createdById`/`updatedById` → `SET NULL`). Applied via `prisma migrate deploy` against the production RDS instance.

## Prisma Changes

- Added `FinancialScenario` model + `ScenarioType` enum.
- Added back-relations: `Restaurant.financialScenarios`, `Branch.financialScenarios`, `User.financialScenariosCreated` / `financialScenariosUpdated`.

## APIs Added

All under `/api/scenarios`, mirroring `budget.routes.ts`'s exact auth/ownership pattern (`authMiddleware` + `requireOwnRestaurant()` on `:restaurantId`; per-scenario ownership checked in the service layer):

| Method | Path | Purpose |
|---|---|---|
| POST | `/:restaurantId` | Create a scenario |
| GET | `/:restaurantId` | List scenarios (`?branchId=`, `?type=`, `?activeOnly=`) — auto-creates built-ins for the requested scope |
| GET | `/:restaurantId/:scenarioId` | Get one scenario |
| PUT | `/:restaurantId/:scenarioId` | Update name/description/isActive/overrides |
| POST | `/:restaurantId/:scenarioId/clone` | Clone with overrides carried over |
| PUT | `/:restaurantId/:scenarioId/reset-fields` | Reset specific override fields to null |
| DELETE | `/:restaurantId/:scenarioId` | Delete (CUSTOM only — built-ins rejected) |
| POST | `/:restaurantId/:scenarioId/what-if` | Run the What-If Engine (`?period=&from=&to=`); optional body = live, unsaved override deltas |

## UI Screens Added

`owner-web/src/pages/scenario/` — 5 tabs under a new `/dashboard/scenario-analysis` route, structurally identical to Budget's shell/tab pattern:

- **Overview** — scenario + period selectors, What-If sliders panel, 6 KPI cards, charts, full KPI table.
- **Scenarios** — list/create/edit/clone/delete/reset (`ScenariosTab.tsx`), same list→create→edit view-state-machine as `BudgetsTab.tsx`.
- **Comparison** — Actual vs Budget vs N selected scenarios, cells highlighted green/red by direction-aware improvement.
- **Branch Comparison** — apply one scenario across every branch, ranked table.
- **Reports** — 4 report types, PDF/Excel/CSV/Print export.

No new shared/global UI components were introduced — every piece (KPI card styling, variance table, period-pill selector, chart mode switcher, export handlers) reuses the exact class names and structural patterns already established in `pages/budget/*`, per the "follow the architecture established in previous phases" mandate. No Redux slice, no RTK Query, no MUI, no form library — matches the rest of the app (local `useState` + `fetch` + `useAppSelector`).

## Dashboard Changes

- New sidebar nav entry "Scenario Analysis" (`BeakerIcon`) in `DashboardLayout.tsx`, positioned directly after "Budget vs Actual".
- New route `scenario-analysis` registered in `AppRoutes.tsx` under the existing `/dashboard` layout.

## Reports Added

Scenario Summary, Scenario Comparison, Branch Scenario Report, Restaurant Scenario Report — one `ReportsTab.tsx`, four data-shapes, all sharing the same `jsPDF`/`ExcelJS`/`file-saver` export functions already used by `budget/ReportsTab.tsx` (same brand color, same table-based layout).

## Charts Added

`ScenarioCharts.tsx` — Variance % by KPI (colored green/red like Budget's monthly variance chart), plus Baseline-vs-Projected cards for 8 headline KPIs, each with a Line/Bar/Area/Stacked-Bar mode toggle (`TrendChart`-equivalent pattern reused from `BudgetCharts.tsx`).

## Tests Added

- **`scenario.validation.test.ts`** (24 tests, unit) — bounds checking, null-clears-field semantics, unknown-field rejection, create/update payload shaping.
- **`scenario.service.test.ts`** (23 tests, unit) — direct tests of the What-If Engine's precedence logic (`applyScenarioOverrides`, exported solely for testability): orders/AOV/revenue precedence, food-cost-is-variable vs labour-is-semi-fixed, rent proration/escalation/override precedence, inflation escalation, finance-cost-always-carried-over.
- **`scenario.integration.test.ts`** (10 tests, real DB) — built-in auto-creation/idempotency, CRUD, live (unsaved) override behavior, reset, clone, delete rules (built-in vs custom), restaurant-wide multi-branch aggregation, ownership isolation.
- Result: unit suite grew from 82 → 129 tests; integration suite grew from 7 → 17 tests. All passing.
- **Live-DB verification scripts** (36 backend assertions + 12 Playwright browser assertions across all 5 UI tabs) run against the actual production-schema database and a live dev server, re-run after every refactor to confirm zero regression.

## Performance

- No new duplicate calculations or DB access patterns. The What-If Engine's baseline resolution reuses `resolveScopedMetrics`/`fetchInsightsForScope`/`getMenuItemCostMap` — the *same* functions Budget's Variance Engine calls — fetched once per request and reused across the current- and previous-period calls needed for trend.
- `menuItemCostMap`, `restaurantInsights`, and resolved `FinancialAssumptions` are each fetched exactly once per what-if request (in parallel via `Promise.all`), never per-KPI or per-branch redundantly.
- Frontend What-If sliders are debounced (350ms) so a drag gesture fires one recalculation request, not one per pixel.
- No caching was introduced — per the phase brief's "only introduce caching after profiling," and because per-request cost here (1-2 lightweight queries reused across ~2 periods) is identical to Budget's already-accepted cost profile.

## Files Modified / Added

**Backend:**
- `prisma/schema.prisma`, `prisma/migrations/20260727010000_add_financial_scenario/migration.sql` (new)
- `src/modules/finance/finance.service.ts` — extended with `getExpenseBreakdown`, `ScopedFinancialBundle`, `resolveScopedMetrics`, `fetchInsightsForScope` (consolidated up from Budget so Scenario could reuse them without a second implementation)
- `src/modules/budget/budget.service.ts` — refactored to import the above instead of its own private copies (zero behavior change, verified)
- `src/modules/scenario/` (new) — `scenario.types.ts`, `scenario.validation.ts`, `scenario.service.ts`, `scenario.controller.ts`, `scenario.routes.ts`, `scenario.service.test.ts`, `scenario.validation.test.ts`, `scenario.integration.test.ts`
- `src/routes/index.ts` — registered `/api/scenarios`

**Frontend:**
- `src/pages/scenario/` (new) — `ScenarioAnalysis.tsx`, `OverviewTab.tsx`, `ScenariosTab.tsx`, `ComparisonTab.tsx`, `BranchComparisonTab.tsx`, `ReportsTab.tsx`, `ScenarioCharts.tsx`, `scenarioCategories.ts`
- `src/routes/AppRoutes.tsx`, `src/layouts/DashboardLayout.tsx` — route + nav entry

## Design Decisions

1. **Variable costs scale with projected revenue; semi-fixed costs stay flat by default.** Food cost is modeled as a genuinely variable cost — it scales proportionally with projected revenue at either an explicit `foodCostTargetPercentage` or the baseline ratio. Labour, rent, utilities, marketing, maintenance, and packaging are semi-fixed: they stay at their baseline figure unless the scenario explicitly sets an override or an escalator (`salaryIncrementPercentage`, `rentEscalationPercentage`, `inflationPercentage`). This is a deliberate restaurant-finance modeling choice, not an oversight — a naive "everything scales with revenue" model would misrepresent how rent and salaries actually behave.

2. **Revenue precedence: explicit growth % beats orders × AOV.** When `revenueGrowthPercentage` is set, it wins outright, even if `orderGrowthPercentage`/`avgOrderValue` are also set (those still independently affect the Orders/AOV KPI rows, just not Revenue). When no explicit revenue lever is set but orders or AOV changed, revenue is derived as `projectedOrders × projectedAOV`. This gives a scenario author one predictable answer to "which number wins" instead of an ambiguous blend.

3. **Absolute ₹ overrides (rent, utilities, marketing, maintenance, packaging) are prorated to the requested period exactly like every other monthly figure** the Finance Engine handles (`prorateMonthly`, which normalizes against a fixed 30-day month — an existing, pre-Scenario convention shared with Budget and the Ratio Engine). This was caught and fixed during live-DB verification: an unprorated override would have silently mismatched the baseline's own proration for any period that isn't exactly 30 days (e.g. a 31-day July).

4. **Scope-disclosed limitation: Delivery %, Swiggy/Zomato Commission %, Royalty %, Franchise Fee % are stored, inheritable, and resettable, but do not feed into the projected P&L in this phase.** Wiring them in would require inventing a new formula for how they interact with the already-included `aggregatorCommission` baked into baseline `variableExpenses` — risking either double-counting or an unjustified new calculation, both of which conflict with "the Finance Engine must remain the single source of truth." Disclosed here rather than silently faked.

5. **Cash Flow is reserved, not fabricated.** No real cash-flow data source exists yet anywhere in the app (Budget's own variance rows already report it as `no-data`); Scenario follows the same honest precedent rather than inventing a proxy calculation.

6. **No Redux slice / RTK Query / MUI / form library for the new UI** — the existing Budget, Insights, and Financial Statements pages already establish local `useState` + `fetch` + `useAppSelector` as this app's actual convention; introducing a different data-fetching layer just for Scenario would violate architectural consistency for no functional gain.

## Final Validation

- ✅ Backend builds (`npm run build`, `prisma generate && tsc`) — clean.
- ✅ Frontend builds (`npm run build`, `vite build`) — clean, no new warnings beyond the pre-existing single-large-chunk warning.
- ✅ All 129 unit tests pass (`npm test`); all 17 integration tests pass (`npm run test:integration`).
- ✅ 36/36 live-DB backend assertions pass, including multi-branch restaurant-wide aggregation, live-override-not-persisted, reset, and clone paths.
- ✅ 12/12 Playwright browser assertions pass across all 5 Scenario Analysis tabs, driven against the live dev server — zero console errors originating from any Scenario code path (one pre-existing, unrelated hydration warning on the public marketing home page's `Navbar` was observed and is out of scope for this phase).
- ✅ Manually verified every What-If Engine calculation by hand against real seeded data (see the precedence tests in `scenario.service.test.ts` and the hand-computed live assertions in the verification scripts).
- ✅ No scenario code path writes to `Order`, `Bill`, `RestaurantInsights`, `Budget`, or any financial-statement table — confirmed by re-running the baseline what-if call twice and observing identical actuals both times.
- ✅ Every calculation reuses `computeFinancialMetrics`/`computeVariance` from `finance.formulas.ts` and `computeAchievement` from `finance.ratios.ts`, unmodified — zero duplicate financial-formula logic anywhere in the Scenario module.
