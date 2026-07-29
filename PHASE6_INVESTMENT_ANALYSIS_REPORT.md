# Phase 6 — Investment Analysis & Capital Planning

Helps a restaurant owner evaluate a capital investment — a new branch, an equipment purchase, a renovation, a marketing push — before committing money, by combining Actual data (via the Finance Engine), Forecast projections (Phase 5), and Scenario what-ifs (Phase 4) into industry-standard investment metrics: ROI, NPV, IRR, Payback Period, and Profitability Index.

## Features Added

1. **Investment CRUD** — create, list, get, update, delete investment projects, scoped to a restaurant or a specific branch, with a status lifecycle (Planned → In Progress → Completed/Cancelled).
2. **9 investment types** — New Branch, Branch Expansion, Kitchen Upgrade, Equipment Purchase, Interior Renovation, Delivery Expansion, Marketing Investment, Franchise Outlet, Custom.
3. **10 assumption fields** per project — Initial Investment, Monthly Revenue Increase, Annual Revenue Growth %, Expected Cost Savings, Labour Savings, Additional Operating Expenses, Maintenance Cost, Salvage Value, Discount Rate, Inflation Rate — each optional, defaulting from the Financial Assumptions Engine at creation time where an equivalent exists (Inflation Rate), or a documented finance-standard fallback otherwise (Discount Rate → 12%, since no hurdle-rate concept exists anywhere else in the app).
4. **Investment Engine** — Annual/Cumulative/Discounted Cash Flow projection, ROI, Annualized ROI, Payback Period, Discounted Payback Period, NPV, IRR (Newton-Raphson with a bisection fallback), Profitability Index. Every metric derives from the exact same single cash-flow projection, so they can never disagree with each other about what the cash flows actually are.
5. **Forecast Integration** — "Current Forecast vs Forecast With Investment," reusing `generateForecastService` (Phase 5, unmodified) for the branch/restaurant's own baseline, with the investment's own Year-1 cash-flow effect layered on top.
6. **Scenario Integration** — "evaluate this investment under Conservative/Expected/Optimistic/Custom," reusing `runWhatIfService` (Phase 4, unmodified): the referenced scenario's effect on revenue is substituted for the project's own revenue-growth assumption.
7. **Investment Analysis dashboard** — portfolio summary (Capital Deployed, Average ROI, Total NPV, Expected Annual Return), Top Performing Projects / Projects Requiring Attention lists (each showing ROI/NPV/IRR/Payback and a risk badge), and portfolio-wide charts.
8. **Branch Comparison** — ranks branches by total NPV across their investment projects, with each branch's best ROI and shortest payback surfaced alongside.
9. **Reports** — Investment Summary, ROI, NPV, IRR, Payback, Cash Flow, Investment Comparison, each exportable as PDF/Excel/CSV/Print.

## Database Changes

One new table, additive only — no existing table altered.

```prisma
enum InvestmentType { NEW_BRANCH BRANCH_EXPANSION KITCHEN_UPGRADE EQUIPMENT_PURCHASE INTERIOR_RENOVATION DELIVERY_EXPANSION MARKETING_INVESTMENT FRANCHISE_OUTLET CUSTOM }
enum InvestmentStatus { PLANNED IN_PROGRESS COMPLETED CANCELLED }

model InvestmentProject {
  id           Int              @id @default(autoincrement())
  restaurantId Int
  branchId     Int?             // null = restaurant-wide
  name         String
  type         InvestmentType   @default(CUSTOM)
  description  String?
  status       InvestmentStatus @default(PLANNED)

  initialInvestment      Float
  plannedStartDate       DateTime
  expectedCompletionDate DateTime?
  projectLifeYears       Int      @default(5)

  discountRate, inflationRate, monthlyRevenueIncrease,
  revenueGrowthPercentage, expectedCostSavings, labourSavings,
  additionalOperatingExpenses, maintenanceCost, salvageValue  Float?

  createdById Int?
  createdAt, updatedAt DateTime

  restaurant Restaurant @relation(...)
  branch     Branch?    @relation(...)
  createdBy  User?      @relation("InvestmentProjectCreatedBy", ...)

  @@index([restaurantId])
  @@index([branchId])
  @@index([restaurantId, status])
}
```

**Migration**: `prisma/migrations/20260728020000_add_investment_project/migration.sql` — hand-written, additive-only, mirroring `FinancialScenario`'s exact FK conventions (`restaurantId`/`branchId` → `RESTRICT`, `createdById` → `SET NULL`). Applied via `prisma migrate deploy` against the production RDS instance.

**Design decision — one flat table, not four.** The spec suggested `InvestmentProject`, `InvestmentCashFlow`, `InvestmentAssumption`, and `InvestmentScenario`. Only `InvestmentProject` was built:
- **No `InvestmentAssumption` table** — the field set is bounded and non-repeating, so it lives directly on `InvestmentProject` as individual nullable `Float?` columns, matching `FinancialScenario`/`FinancialAssumptions`' own established precedent.
- **No `InvestmentCashFlow` table** — the year-by-year cash flow stream ROI/NPV/IRR need is computed on demand from the assumption fields (plus optional Forecast/Scenario integration), exactly like Scenario's What-If Engine computes projections on demand rather than persisting them. It is never stored, so it's always in sync with the latest assumptions and never goes stale.
- **No `InvestmentScenario` table** — "evaluate under Conservative/Expected/Optimistic/Custom" reuses the *existing* `FinancialScenario` rows for the investment's branch (via an optional `scenarioId` query param), rather than re-implementing scenario types a second time. This is a direct, literal application of the phase brief's own instruction to "reuse the existing... Scenario Engine."

**A note on `RestaurantInsights.initialInvestment`**: audited before building this phase (confirmed via a full-codebase grep) — it is a seed-data-only field with no live calculation reading it anywhere in the app (no existing ROI ratio exists). It remains untouched and is a different, branch-level "sunk cost" concept from this phase's per-project `InvestmentProject.initialInvestment` (a branch can have several concurrent investment projects with independent timelines).

## APIs Added

All under `/api/investments`, mirroring `scenario.routes.ts`/`forecast.routes.ts`'s exact auth/ownership pattern:

| Method | Path | Purpose |
|---|---|---|
| POST | `/:restaurantId` | Create an investment project |
| GET | `/:restaurantId` | List projects (`?branchId=&status=&type=`) |
| GET | `/:restaurantId/with-metrics` | List projects with their computed metrics attached (`?scenarioId=`) |
| GET | `/:restaurantId/portfolio` | Portfolio summary — capital deployed, average ROI, total NPV, top performing, needs attention |
| GET | `/:restaurantId/branch-ranking` | Rank branches by total NPV across their projects |
| GET | `/:restaurantId/:investmentId` | Get one project |
| PUT | `/:restaurantId/:investmentId` | Update name/description/status/assumptions |
| DELETE | `/:restaurantId/:investmentId` | Delete a project |
| GET | `/:restaurantId/:investmentId/metrics` | ROI/NPV/IRR/Payback for one project (`?scenarioId=` to evaluate under a scenario) |
| GET | `/:restaurantId/:investmentId/forecast-comparison` | Current Forecast vs Forecast With Investment |

## UI Screens Added

`owner-web/src/pages/investment/` — 4 tabs under a new `/dashboard/investment-analysis` route, structurally identical to Budget/Scenario/Forecast's shell/tab pattern:

- **Overview** — portfolio summary cards, Top Performing/Needs Attention project lists (each with a risk badge), portfolio-wide charts.
- **Projects** — list/create/delete, and a detail view showing full ROI/NPV/IRR/Payback metric cards, a cumulative cash flow chart, a scenario evaluator, the Forecast With vs Without Investment table, and the editable assumptions form.
- **Branch Comparison** — ranked table by total NPV, with best ROI and shortest payback per branch.
- **Reports** — 7 report types, PDF/Excel/CSV/Print export.

No new shared/global UI components were introduced — every piece reuses the exact structural patterns already established in `pages/budget/*`, `pages/scenario/*`, and `pages/forecast/*`.

## Dashboard Changes

- New sidebar nav entry "Investment Analysis" (`BuildingLibraryIcon`) in `DashboardLayout.tsx`, directly after "Forecasting".
- New route `investment-analysis` registered in `AppRoutes.tsx` under the existing `/dashboard` layout.

## Financial Models Implemented

- **ROI** — `(total cash flow − initial investment) / initial investment × 100`, plus an annualized figure (ROI ÷ project life years).
- **Payback Period** — the fractional year at which cumulative (undiscounted) cash flow first turns non-negative; `null` if it never does within the project life.
- **NPV** — the sum of cash flows (year 0 = −initial investment, undiscounted; years 1..N discounted at the project's discount rate).
- **Discounted Payback Period** — the same idea as Payback Period, but on discounted cash flows — a stricter break-even measure accounting for the time value of money.
- **IRR** — the discount rate at which NPV = 0, solved via Newton-Raphson (with a bisection fallback over −99%..+1000% for cases where the derivative is near zero or the initial guess doesn't converge); returns `null` when no real root exists (e.g. every cash flow is the same sign).
- **Profitability Index** — `(NPV + initial investment) / initial investment`.
- All formulas are pure functions in `investment.formulas.ts`; verified via 24 unit tests using textbook cash-flow examples with exact, hand-derivable answers (e.g. a single-period 1000→1100 cash flow has an IRR of exactly 10%; a 3-year 1000→0→0→1331 stream also resolves to exactly 10%).

## Reports Added

Investment Summary Report, ROI Report, NPV Report, IRR Report, Payback Report, Cash Flow Report, Investment Comparison Report — all exportable as PDF/Excel/CSV/Print via the same `jsPDF`/`ExcelJS`/`file-saver` pattern established in Phases 2-5.

## Charts Added

`InvestmentCharts.tsx` (portfolio-wide, Overview tab) — Cash Flow Timeline (cumulative cash flow per year, one line per project), ROI Comparison, NPV Comparison, Investment vs Return, Payback Timeline. Per-project detail (Projects tab) — a Cumulative Cash Flow bar chart (color-coded red/green, the practical interpretation of "waterfall" — recharts has no native waterfall chart type) and the Forecast With vs Without Investment comparison table.

## Tests Added

- **`investment.formulas.test.ts`** (24 tests, unit) — `computeAnnualCashFlows`'s revenue-growth-vs-inflation-escalation distinction and salvage-value timing, `computePaybackPeriod`/`computeDiscountedPaybackPeriod`'s fractional-year interpolation, `computeNPV`/`computeIRR` against exact textbook cash-flow examples (including verifying the solved IRR actually zeroes out the NPV of the same cash flows — the real test of numerical correctness), `computeProfitabilityIndex`/`computeROI` edge cases.
- **`investment.integration.test.ts`** (10 tests, real DB) — creation with assumption defaulting, ROI/NPV/IRR/Payback matching hand-computed values, Scenario integration (verifying the exact cash-flow shift a +20% scenario override produces), Forecast comparison (verifying the exact revenue/EBITDA uplift), branch ranking, portfolio summary, CRUD, ownership isolation.
- Result: unit suite grew from 158 → 182 tests; integration suite grew from 26 → 36 tests. All passing.
- **Live-DB verification scripts**: 25 backend assertions and 16 Playwright browser assertions across all 4 UI tabs — all passing, all test data cleaned up.

### Worked example (used throughout the tests above)

₹100,000 equipment purchase, 3-year life, 10% discount rate, ₹5,000/month revenue increase, no growth/inflation/savings/costs:
- Annual cash flows: `[60000, 60000, 60000]` (flat — no growth assumption set).
- **ROI** = (180,000 − 100,000) / 100,000 × 100 = **80%**.
- **Payback Period**: cumulative −100,000 → −40,000 → +20,000 — crosses zero during Year 2 (40,000 of that year's 60,000 needed) = **1.67 years**.
- **NPV @ 10%**: −100,000 + 60,000/1.1 + 60,000/1.21 + 60,000/1.331 ≈ **₹49,210**.
- **IRR**: solved at **36.3%** — independently verified by plugging it back into the NPV formula for these exact cash flows and confirming it lands within ₹5 of zero.
- **Profitability Index**: (49,210 + 100,000) / 100,000 = **1.49**.
- **Under a +20% revenue-growth Scenario**: cash flows become `[60000, 72000, 86400]` (Year 1 unaffected — growth compounds from Year 2 onward), lifting ROI to 118.4%.
- **Forecast comparison**: Revenue uplift = ₹60,000/year (the monthly increase × 12); EBITDA/Net Profit uplift = ₹60,000/year (the Year-1 net cash flow, which already nets any cost-side effects — coincidentally identical here since this fixture has no cost savings/opex).

## Performance

- No new duplicate calculations or DB access patterns. Forecast comparison and Scenario evaluation both call the *existing* `generateForecastService`/`runWhatIfService` unmodified, with `persist: false` where relevant (Forecast comparison) so that viewing an investment's projections never silently accumulates Forecast snapshots.
- `listInvestmentsWithMetricsService` computes each project's metrics independently and in-process (pure math, no DB round-trip per metric) — the only DB cost is the one `findMany` query for the project rows themselves, regardless of how many metrics are derived from each.
- Branch ranking and portfolio summary both reuse `listInvestmentsWithMetricsService` — one query, computed once, reused for both aggregation and detail display.

## Files Modified / Added

**Backend:**
- `prisma/schema.prisma`, `prisma/migrations/20260728020000_add_investment_project/migration.sql` (new)
- `src/modules/investment/` (new) — `investment.types.ts`, `investment.formulas.ts`, `investment.validation.ts`, `investment.service.ts`, `investment.controller.ts`, `investment.routes.ts`, `investment.formulas.test.ts`, `investment.integration.test.ts`
- `src/routes/index.ts` — registered `/api/investments`

**Frontend:**
- `src/pages/investment/` (new) — `InvestmentAnalysis.tsx`, `OverviewTab.tsx`, `ProjectsTab.tsx`, `BranchComparisonTab.tsx`, `ReportsTab.tsx`, `InvestmentCharts.tsx`, `investmentCategories.ts`
- `src/routes/AppRoutes.tsx`, `src/layouts/DashboardLayout.tsx` — route + nav entry

## Design Decisions

1. **Capital-budgeting math (ROI/NPV/IRR/Payback) is genuinely new — there is no existing formula to reuse for it.** Unlike Scenario/Forecast, which layer new logic on top of `computeFinancialMetrics`, nothing in this app computed a discounted cash flow before this phase. "Reuse the Finance Engine" for this phase is satisfied at the integration points instead: the Forecast Engine supplies the baseline projection for comparison, and the Scenario Engine supplies the growth-rate adjustment for "evaluate under X" — both reused completely unmodified.
2. **Scenario integration is a documented simplification, not a second scenario-math implementation.** A monthly What-If variance (e.g. "+20% this month under the Conservative scenario") is used as a stand-in *annual* compounding growth rate for the investment's own multi-year projection. This is a deliberate, disclosed approximation — building a true annualized scenario-projection concept was out of scope for this phase and would have meant extending the Scenario Engine itself, which the brief explicitly said to reuse, not modify.
3. **The revenue effect and the net cash flow effect are applied to different Forecast rows, never both to the same one.** Forecast comparison adds the investment's *revenue increase alone* to the Revenue row, but the *full net cash flow* (already netting cost savings/opex/maintenance) to EBITDA and Net Profit — avoiding double-counting the cost side.
4. **No tax or depreciation modeling.** Consistent with the app's existing EBITDA-centric convention (Net Profit = EBITDA − Finance Cost, established in Phase 1), this phase does not model corporate tax or depreciation schedules — a disclosed simplification appropriate for a first-pass capital-planning tool, not a hidden gap.
5. **"Risk Indicator" is a simple, documented three-tier heuristic** (negative/zero NPV or a payback that never happens = High risk; a payback beyond half the project life = Medium; otherwise Low) rather than a statistical risk model — transparent and explainable to a restaurant owner, matching the same "documented heuristic over a black box" approach already used for Forecast's confidence scoring (Phase 5).
6. **No Redux slice / RTK Query / MUI / form library for the new UI** — consistent with every prior phase's established convention (local `useState` + `fetch` + `useAppSelector`).

## Final Validation

- ✅ Backend builds (`npm run build`, `prisma generate && tsc`) — clean.
- ✅ Frontend builds (`npm run build`, `vite build`) — clean, no new warnings beyond the pre-existing single-large-chunk warning.
- ✅ All 182 unit tests pass (`npm test`); all 36 integration tests pass (`npm run test:integration`).
- ✅ 25/25 live-DB backend assertions pass, including hand-computed ROI/NPV/IRR/Payback, Scenario integration, Forecast integration, branch ranking, and CRUD.
- ✅ 16/16 Playwright browser assertions pass across all 4 Investment Analysis tabs, driven against the live dev server — zero Investment-specific console errors (the same pre-existing, unrelated public-marketing-page hydration warning noted in Phases 4-5 was observed again and remains out of scope).
- ✅ Manually verified ROI, NPV, IRR, and Payback against a constructed cash-flow example by hand (see the worked example above) — matched exactly, including confirming the solved IRR truly zeroes out the NPV of the same cash flows.
- ✅ Confirmed every investment calculation remains consistent with the existing Finance Engine — Forecast/Scenario integration calls `generateForecastService`/`runWhatIfService` unmodified; no investment code path duplicates any existing financial formula.
- ✅ No duplicate financial calculations anywhere — the only new math is the capital-budgeting formulas themselves, which have no pre-existing equivalent in the app.
