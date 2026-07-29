# Final Enterprise Application Audit — Production Release Candidate (Post Phase 1–8)

**Status: PARTIAL AUDIT.** A 14-dimension parallel audit was launched; 8 dimensions completed with independent adversarial verification of every flagged finding, 2 completed discovery but their verification pass was cut off, and 5 dimensions never started at all because the audit run hit a session usage cap partway through (resets 3:30am IST). This document reports exactly what was and wasn't covered — see §16 for the precise list of what still needs to run. **No code has been modified.** This is Phase 1 (audit) only, per instruction.

---

## 1. Executive Summary

The core of the application — the Finance Engine built in Phase 1 and the Budget/Scenario/Forecast/Investment/Executive/AI Advisor stack built in Phases 2–8 — is genuinely consistent. Every number in that stack traces back to one function (`resolveScopedMetrics` / `computePeriodMetrics` in `finance.service.ts`), confirmed by two independent audit passes reading the actual code, not just the imports. Budget Variance, Forecast, Forecast Accuracy, Scenario, Investment ROI/NPV/IRR/Payback, and Business Health Score are each computed in exactly one place with zero duplicate implementations found.

The problems are all at the **edges** — in screens and modules built before or alongside the 8-phase engine that were never fully wired to it:

- **Bills.tsx** (the Billing Overview page) computes "Revenue" with no status filter at all, silently counting unpaid, partial, and unbilled in-progress orders as revenue — a real correctness bug, not just an inconsistency.
- **Branch Comparison** shows a field literally labeled "Net Profit" that is actually EBITDA computed from a different expense data source than every other screen — and Executive's own Multi-Branch view shows two *further* different numbers ("EBITDA" and "Profit") for the same branch/period. Three numbers, one concept, same screen family.
- **Dashboard.tsx**'s headline Revenue tile and **Customers.tsx**'s "Repeat Customer Rate" each independently recompute a concept the rest of the app already has a canonical source for.
- **The AI Financial Advisor**, while never fabricating numbers, violates its own stated traceability contract in 9 of its rule/answer functions — quoting a real number in prose that isn't listed in `supportingMetrics`.
- **Real, uncounted labour cost**: overtime pay is tracked and shown to owners on the Attendance page but is completely absent from every EBITDA/Net Profit calculation everywhere else in the app.
- The production frontend bundle is a single **12.4 MB (3.4 MB gzipped)** JS file with zero code-splitting.
- There is **no end-to-end test suite anywhere in the repo** — confirmed by direct search, not inference.

Unit tests (233/233) and integration tests (55/55) pass, and both repos build cleanly.

## 2. Overall Architecture Review

The layered architecture established in Phase 1 (`finance.service.ts`/`finance.formulas.ts` as the sole calculation layer, consumed by service-layer imports rather than HTTP calls between backend modules) holds up well through Phase 8 — `executive.service.ts`, `budget.service.ts`, `scenario.service.ts`, `forecast.service.ts`, and `ai.service.ts` all import the Finance Engine's exported functions directly and were confirmed (by reading function bodies, not just import statements) to never re-derive Revenue/Food Cost/Labour/EBITDA from a fresh Prisma query. `investment.service.ts` correctly treats ROI/NPV/IRR/Payback as genuinely new capital-budgeting math (no prior duplicate existed) and reuses `generateForecastService`/`runWhatIfService` rather than re-deriving cash flows itself.

The architectural weak point is that this discipline was never retroactively applied to `analytics.service.ts` (Dashboard's own Prisma layer), `bill.service.ts` (Bills.tsx's backend), `customer.service.ts` (Customers.tsx's backend), or `branchComparison.service.ts` — four backend services that predate or sit alongside the Finance Engine and still maintain their own independent Prisma aggregation logic for concepts (Revenue, Repeat Customers, Net Profit) the Finance Engine already owns.

## 3. Financial Consistency Audit

**Confirmed consistent** (read and adversarially re-verified):
- Revenue, Food Cost, Food Cost %, Labour Cost, Labour %, Prime Cost, Gross Profit, Gross Margin %, EBITDA, EBITDA %, Finance Cost, Net Profit, Contribution Margin, Break-even Revenue/Orders, Margin of Safety — identical across Dashboard's EBITDA tile, Insights.tsx (when its fetch succeeds), StatsStrip's EBITDA tile, Executive Dashboard, Budget vs Actual, Scenario Analysis, Forecasting, Investment Analysis, and AI Financial Advisor.
- Budget Variance, Forecast, Forecast Accuracy, Scenario What-If, Investment Portfolio metrics, Business Health Score — each computed exactly once and reused identically by both Executive Dashboard and the AI Advisor. **Zero findings** on this dimension.
- Labour Cost % specifically — independently verified to be byte-for-byte the same proration formula in Branch Comparison and the Finance Engine.
- Repeat Customer Rate between Branch Comparison and Executive Dashboard — provably identical, because Executive literally calls Branch Comparison's own function rather than recomputing.

**Confirmed inconsistent** (with severity and exact evidence):

| # | Finding | Severity | Where |
|---|---|---|---|
| F1 | Bills.tsx's Revenue/Avg Bill has **no status filter at all** — sums PAID, UNPAID, PARTIAL bills and unbilled in-progress RunningOrders together, vs. the Finance Engine's PAID-only definition | **High** | `owner-web/src/components/bills/Bills.tsx`, `dineink-backend/src/modules/bills/bill.service.ts:250-330` |
| F2 | Branch Comparison's "Net Profit" is actually EBITDA (no finance cost subtracted), computed from real `ShopExpense` transactions, while Executive's Multi-Branch view shows separate "EBITDA" and "Profit" columns computed from prorated `RestaurantInsights` assumptions + finance cost — **three different numbers for the same concept on the same branch/period** | **High** | `branchComparison.service.ts:174-183` vs `executive.service.ts:287-288`/`finance.service.ts` |
| F3 | Dashboard.tsx's "Revenue" stat tile is sourced from `analytics.service.ts`'s own independent Prisma aggregate, not the Finance Engine — even though the adjacent EBITDA tile on the same screen *is* Finance-Engine-sourced | Medium | `Dashboard.tsx:133-144`, `analytics.service.ts:132/191-196` |
| F4 | Insights.tsx silently and **permanently** falls back to a structurally different client-side EBITDA/Prime Cost/Net Profit calculation (inventory-snapshot food cost, not recipe-cost × units sold) whenever its Finance Summary fetch fails — no error banner, no retry | Medium | `Insights.tsx:617-629, 249-323` |
| F5 | Customers.tsx's "Repeat Customer Rate" uses a **third definition** — lifetime history, any bill status (including CANCELLED/PENDING) — vs. Executive/Branch Comparison's PAID-only, period-scoped definition | High | `Customers.tsx:43,101` vs `customer.service.ts:22` vs `branchComparison.service.ts:76-85` |
| F6 | Customers.tsx's Churn Rate/LTV use fixed 30/60/365-day windows from the browser clock, completely disconnected from the app's period selector used everywhere else | Medium | `Customers.tsx:48,76-133` |
| F7 | Customers.tsx's CAC denominator (new customers) is restaurant-wide while the LTV numerator is branch-scoped — LTV:CAC silently mixes scopes when a specific branch is selected | Medium | `Customers.tsx:135-138`, `analytics.service.ts:205-211` (Customer model has no `branchId`) |
| F8 | Real overtime pay (tracked via Attendance, shown to owners on the Attendance/Productivity page) is **completely absent** from Finance Engine / Branch Comparison labour cost — EBITDA/Net Profit systematically omit real payroll spend | Medium | `finance.service.ts:196` vs `analyticsAdvanced.service.ts:426-490`, `Attendance.tsx:71-84` |
| F9 | Attendance's "Today (Present)" payroll widget only counts clocked-in staff, vs. the Finance Engine's full-headcount monthly-salary proration — two different conventions for "today's labour cost" (already partially labeled as an estimate) | Low | `Attendance.tsx:238-243` vs `finance.service.ts:185-196` |
| F10 | Cash Reconciliation (`DailyCashSession`) is correctly, consistently treated as till reconciliation everywhere — **confirmed clean**, explicitly never conflated with a "Cash Flow" P&L figure (Budget/Forecast/Scenario all correctly return `null` for that category rather than fabricate one from it) | Info (no issue) | — |

## 4. Operational Consistency Audit

- **Shops.tsx**: clean — no financial aggregation of any kind, pure branch/staff/billing-config management.
- **Kitchen.tsx**: its "Total Orders" KPI comes from one dedicated service (not ad hoc queries) but counts a genuinely different concept (completed kitchen prep events) than Dashboard's "Total Orders" (PAID bills) — a naming-collision risk, not a bug; recommend relabeling to "Orders Completed by Kitchen" (Low).
- **Bills.tsx**: see F1 above, plus it **ignores the global date-range selector entirely** — its backend query has no date filter at all and is hardcapped to the most recent 200 rows, so it can silently drop older records for busy branches and can never be reconciled with any other screen's selected period (Medium).
- **Attendance/Cash**: see F8–F10 above.
- **Inventory/Vendors/Procurement**: **not audited this pass** — see §16.
- **Database/Code Quality**: **not audited this pass** — see §16, except one item carried over from an earlier manual audit (not re-verified in this run): `branchComparison.service.ts` maintains its own local `daysInRange()` helper, separate from the canonical one in `utils/dateRange.ts` that was itself fixed for an off-by-one bug in Phase 1 — a duplicated-helper risk worth re-checking (Low, unverified this pass).

## 5. KPI Traceability Matrix

| KPI | Canonical calculation | Consumers confirmed consistent | Consumers confirmed inconsistent |
|---|---|---|---|
| Revenue | `finance.service.ts` → `computePeriodMetrics` (Bill.aggregate, status=PAID) | Insights, StatsStrip(EBITDA calc), Executive, Budget, Scenario, Forecast, Investment, AI | Dashboard.tsx Revenue tile (F3), Bills.tsx (F1) |
| Food Cost / % | `finance.service.ts` → `getFoodCostForPeriod` (recipe cost × units sold, or manual override) — also reused by Menu Engineering's `recipeCostOf` | Insights, Executive, Budget, Scenario, Forecast, Investment, AI, Menu Engineering, Branch Comparison | — (consistent everywhere checked) |
| Labour Cost / % | `finance.service.ts` → `prorateMonthly(salary sum, days)` | Insights, Executive, Budget, Scenario, Forecast, Investment, AI, Branch Comparison | Attendance's overtime (F8) and present-staff-only (F9) figures |
| EBITDA / Net Profit | `finance.formulas.ts` → `computeEBITDA`/`computeNetProfit` | Insights (when fetch succeeds), Executive, Budget, Scenario, Forecast, Investment, AI | Insights fallback (F4), Branch Comparison mislabeling (F2) |
| Repeat Customer Rate | `branchComparison.service.ts` (PAID-only, period-scoped) | Executive Dashboard (calls the same function) | Customers.tsx (F5) |
| Budget Variance | `budget.service.ts` → `getBudgetVarianceService` | Executive, AI | — |
| Forecast / Forecast Accuracy | `forecast.service.ts` | Executive, AI | — |
| Investment ROI/NPV/IRR/Payback | `investment.formulas.ts` → `computeInvestmentMetrics` (only ever called from `investment.service.ts`) | Executive, AI (via `getPortfolioSummaryService` etc.) | — |
| Business Health Score | `executive.formulas.ts` → `computeBusinessHealthScore` | AI Advisor | — |
| Cash | `DailyCashSession` (till reconciliation only) | — | correctly never used as "Cash Flow" anywhere (F10) |
| Inventory Value, Purchase Cost, Vendor Spend | — | **not traced this pass** | **not traced this pass** |

## 6. Duplicate Logic Removed

None yet — **this audit found and verified duplicates but, per instruction, did not remove any.** See §16 for the fix list to execute in a follow-up pass.

## 7. Duplicate APIs Removed

None found that expose conflicting *response shapes* for the same concept — the duplication found is at the calculation layer (multiple backend services independently deriving the same number), not at the API-contract layer. No two APIs were found returning structurally identical fields with different meanings; rather, the same *label* ("Net Profit," "Revenue," "Repeat Customer Rate") appears on different endpoints backed by different formulas (see §3/§5).

## 8. Duplicate Calculations Removed

None yet (audit-only phase). Confirmed duplicate calculation sites: F1 (Bills.tsx revenue), F2 (Branch Comparison net profit/opex), F3 (Dashboard revenue tile), F5 (Customers repeat rate).

## 9. Report Validation

**Not audited this pass** (the `financial-reports-exports` dimension hit the session cap before running). Report.tsx, generatePDF.ts, generateExcel.ts, reportData.ts, and FinancialStatements.tsx were confirmed as migrated onto the Finance Engine in Phase 1's own audit trail, but that has **not been re-verified** against the later "Expand full PDF report and fix refund %" commit or against Phases 2–8's own report tabs. Flagged for the next audit run.

## 10. Export Validation

**Not audited this pass** — same gap as §9.

## 11. Chart Validation

Audited (discovery completed; adversarial verification of these 2 flagged findings was cut off by the session cap, so treat as high-confidence-but-single-pass rather than doubly-verified):

- The overwhelming majority of chart components (Executive, Forecast, Scenario, Investment, AI Timeline reuse, and most of Report.tsx including the Hourly Heatmap/Day Analysis) are pure presentational components reading the exact same fetched state as their page's KPI cards — confirmed clean.
- **Dashboard.tsx's Order Split pie chart (Dine-in vs Online) derives its totals from `analytics.recentOrders`, which the backend truncates to the 10 most recent bills** — for any period with more than 10 orders, this chart will not reconcile with the Revenue KPI card directly above it on the same screen, and the backend already computes a correct, untruncated `revenueByOrderType` map that the chart simply never consumes (**High**, single-pass).
- `BudgetCharts.tsx` issues its own 12-call fetch loop (one `/variance` call per fiscal-year month) instead of reusing the variance data `OverviewTab.tsx` already fetched for its KPI cards — calls the same authoritative endpoint so numbers should still agree, but it's a duplicate-fetch/maintainability smell (Low, single-pass).

## 12. AI Validation

Read `ai.rules.ts` and `ai.service.ts` in full, twice (discovery + adversarial re-verification of every flagged item). Results:

- **Confirmed clean**: `ai.service.ts`'s only Prisma calls are to `AIInsightLog` (its own audit-log table) — no direct financial re-querying anywhere. No hardcoded fallback numeric constant is used as a substitute for real data anywhere in the file.
- **Confirmed violation of the module's own stated contract** ("summary is a template string filled in ONLY with values present in supportingMetrics"): 9 findings across `fallingProfitabilityRisk`, `risingCostRisk`, `detectAnomaly`, `healthyMarginOpportunity`, `answerWhyFoodCostChangingService`, `answerWhatIfSalesIncreaseService`, and 3 further rules (`revenueChangeInsight`, `foodCostTargetInsight`, `branchUnderperformingPeersRisk`) that each quote a number in prose (a previous-period value, a variance %, a window-size count, a target-gap delta) that is not itself present as a `supportingMetrics` entry — though in the last 3 cases, the number *is* reconstructable by subtracting two values that ARE present, which is a materially lower-severity version of the same gap.
- **Important distinction**: this is a **traceability/auditability gap, not a fabrication bug** — every number quoted, in every case, was independently confirmed to be derived from real engine output. The fix is additive (add the missing `supportingMetrics` entries), not corrective of any wrong number.

## 13. Database Review

**Not audited this pass** (`db-schema-review` dimension hit the session cap before running — zero findings available). Flagged for the next audit run: unused models/fields, missing indexes on hot filter paths, redundant tables.

## 14. Performance Improvements

**Partially audited.** The dedicated `performance-nplus1-queries` dimension did not run (session cap). What surfaced incidentally from other dimensions:

- `BudgetCharts.tsx`'s 12-call-per-page-load fetch loop (§11) — a real, if minor, redundant-query pattern.
- Bills.tsx's backend query has no pagination beyond a hardcoded 200-row cap with no date bound (§4) — a genuine unbounded-data risk for high-volume branches, inverse of the usual N+1 concern (silent truncation instead of runaway query cost).
- **Frontend bundle size**: `owner-web`'s production build emits a single **12.4 MB JS bundle (3.4 MB gzipped)** with no code-splitting — Vite's own build output explicitly warns about this. For a SPA with 20 distinct top-level modules, this means every user downloads the entire app (Kitchen, Procurement, AI Advisor, Investment Analysis, etc.) just to view the login page. This is a real, measurable production performance concern not covered by any of the 14 audit dimensions and worth its own remediation (route-based code-splitting via `React.lazy`).
- A dedicated N+1/duplicate-query sweep of the remaining backend services (vendor history, expense reports, RFM, and anything introduced in Phases 2–8 beyond what surfaced above) is still outstanding.

## 15. Code Quality Review

**Not audited this pass** (`code-quality-architecture` dimension hit the session cap before running). One item carried over from an earlier, separate manual review (not re-verified in this run, flagged for re-confirmation): `branchComparison.service.ts` has its own local `daysInRange()` helper distinct from the canonical, previously-bug-fixed one in `utils/dateRange.ts`.

## 16. Remaining Technical Debt / Audit Coverage Gap

This audit was designed as 14 parallel dimensions with adversarial verification of every flagged finding. The run hit a session usage cap partway through. Exact status:

| Dimension | Status |
|---|---|
| Financial core KPI chain | ✅ Discovery + verification complete |
| Reports/exports financial correctness | ❌ **Did not run** |
| Customer metrics (LTV/CAC/Churn) | ✅ Discovery + verification complete |
| Budget/Scenario/Forecast/Investment/Executive/AI internal consistency | ✅ Discovery + verification complete (zero findings — clean) |
| Inventory/Vendor/Procurement | ❌ **Did not run** |
| Attendance/Payroll/Cash | ✅ Discovery + verification complete |
| Kitchen/Shops/Bills | ✅ Discovery + verification complete |
| Branch Comparison UI vs Multi-Branch | ⚠️ Discovery complete, verification cut off (single-pass only) |
| Chart data-source consistency | ⚠️ Discovery complete, verification cut off (single-pass only) |
| AI Advisor traceability | ✅ Discovery + verification complete |
| Database schema review | ❌ **Did not run** |
| Code quality / architecture | ❌ **Did not run** |
| Performance — N+1/duplicate queries | ❌ **Did not run** (dedicated sweep; incidental findings only) |
| Test suite + build health | ✅ Completed directly (not via subagent, after the cap hit) |

**Recommended next step**: re-run the 5 fully-missing dimensions (Reports/Exports, Inventory/Vendors, DB Schema, Code Quality, N+1 Performance) plus the verification pass for Branch-Comparison-UI and Charts, once the session cap resets.

## 17. Production Readiness Score: **64 / 100**

Reasoning: the load-bearing core (Phase 1's Finance Engine and Phases 2–8's Budget/Scenario/Forecast/Investment/Executive/AI stack) is genuinely single-source-of-truth and passed its consistency check with zero findings — that's the hardest, highest-risk part of "enterprise-grade" to get right, and it's solid. Set against that: two **High**-severity, user-visible correctness/consistency bugs confirmed with concrete evidence (Bills.tsx's unfiltered revenue, and the three-way Net-Profit/EBITDA split between Branch Comparison and Executive's Multi-Branch view), a real uncounted-cost gap (overtime), a genuine third definition of a core customer KPI, a 12MB unsplit bundle, zero E2E coverage, and — most importantly for a "production readiness" score specifically — **5 of 14 audit dimensions never ran at all**, including database schema and a dedicated performance sweep, both squarely relevant to a release-candidate review. This score should be treated as provisional until those 5 dimensions complete.

## 18. Non-blocking Future Improvements

- Route-based code-splitting (`React.lazy`) to break up the 12.4 MB bundle.
- An end-to-end test suite (Playwright or Cypress) — currently zero E2E coverage exists.
- Relabel Kitchen.tsx's "Total Orders" to avoid the naming collision with Dashboard's bill-based "Total Orders."
- Surface Executive's already-computed Repeat Customer Rate on the Multi-Branch table (the API returns it; the UI simply doesn't render the column).
- Add a custom date-range option to Executive's Multi-Branch view so it can be lined up against Branch Comparison's arbitrary date picker.

---

### Verified this session
- Backend build: clean.
- Backend unit tests: **233/233 passing**.
- Backend integration tests (real DB, isolated fixtures): **55/55 passing**.
- Frontend build: clean (with the bundle-size warning noted in §14).
- No Playwright/Cypress config or `*.e2e.*`/`*.spec.ts` files exist in either repo (confirmed by direct search).
