# Phase 8 — AI Financial Advisor & Intelligent Insights

Final phase of the Financial Planning & Analysis platform. Builds an AI-powered
Financial Advisor that continuously analyses restaurant performance and
explains it in plain language — **without** introducing a second financial
calculation engine. Every number in every insight, brief, narrative, or
conversational answer is read from the outputs of Phases 1–7's engines
(Finance, Ratio, Budget, Scenario, Forecast, Investment, Executive) and
recomposed into structured, templated language. No new financial formula
exists anywhere in this phase.

## Features Added

1. **AI Insight Engine** — one shared pass (`generateInsightsService`) that
   composes Executive Overview, Business Health Score, Budget Variance,
   Forecast, Investment Portfolio, Multi-Branch view, and Executive Timeline
   into a single categorized `Insight[]` list.
2. **Natural Language Explanations** — every `Insight.summary` is a template
   string interpolated with real numbers already present in that same
   insight's `supportingMetrics` array. Matches the spec's own examples
   verbatim (e.g. "Revenue increased by 12%…", "Food Cost exceeded the target
   by 4.2%, mainly because…").
3. **Anomaly Detection** — a generic statistical threshold
   (`|deviation| ≥ 1.5σ` from a trailing 11-month baseline) applied to
   Revenue, Net Profit, Food Cost %, and Labour Cost %.
4. **Recommendation Engine** — expand high-performing branches, delay
   low-return investments, review supplier pricing / staffing / menu pricing,
   each citing the metric that triggered it.
5. **Executive AI Brief** — Business Health, biggest wins/risks, budget
   performance, forecast summary, investment updates, branch rankings,
   immediate priorities.
6. **Branch AI Insights** — per-branch narratives comparing AOV, repeat rate,
   Food Cost %, Labour Cost %, and Health Score against the network average.
7. **AI Risk Assessment** — Low/Medium/High/Critical severity across falling
   profitability, rising costs, low forecast confidence, delayed investment
   payback, persistent budget misses, weak business health, declining
   customer growth, and branches significantly behind peers.
8. **AI Opportunity Detection** — high-growth branches, strong-ROI
   investments, improving forecast trends, healthy margins.
9. **Conversational Finance API** — six deterministic, structured endpoints
   answering the spec's own example questions (see below). Not an LLM/chat
   layer — plain service functions any future model can call as tools.
10. **AI Dashboard** — `/dashboard/ai-advisor`, reusing the Executive
    Dashboard's tabbed-page layout and `TrendChart` component.
11. **AI Reports** — 6 report types, PDF/Excel/CSV/Print, reusing the
    Executive Dashboard's export pipeline (jsPDF, ExcelJS, file-saver).
12. **Historical Insight Timeline** — an audit log (`AIInsightLog`) of what
    was flagged over time, idempotent per calendar day.

## AI Architecture

```
Finance / Budget / Scenario / Forecast / Investment / Executive engines
                    │  (already-computed outputs, reused verbatim)
                    ▼
            ai.rules.ts   — pure functions: real numbers in → Insight out
            (templates + a statistical anomaly-detection heuristic;
             no financial formula)
                    ▼
            ai.service.ts — orchestration only: fetches the right engine
            outputs, calls the matching rule functions, assembles
            Insight[] / ExecutiveBrief / BranchNarrative[] / ConversationalAnswer
                    ▼
            ai.controller.ts / ai.routes.ts — thin HTTP layer (validation +
            JSON), mirrors every other Phase's controller pattern
                    ▼
            AIInsightLog — write-only audit log of rendered insights,
            for the Historical Insight Timeline; never read back into a
            calculation
```

No module in this phase queries a `Bill`, `MenuItem`, `Ingredient`, or any
other raw operational table directly — everything flows through an existing
Phase 1–7 service function.

## Insight Generation Flow

`generateInsightsService(restaurantId, branchId, period, from?, to?)`:

1. Fetches, concurrently: Executive Overview, Business Health Score, a
   next-month Forecast (`persist=false` — advisory only, never written to
   `FinancialForecast`), and the Investment Portfolio Summary.
2. Fetches the Executive Timeline separately afterward (see *Performance*
   below for why it's not batched with the above).
3. Looks up the restaurant's published Budget and computes its Variance, if
   one exists.
4. If `branchId === null` (restaurant-wide), also fetches the Multi-Branch
   view, to power branch-comparison risks/opportunities.
5. Passes each already-fetched KPI/forecast/budget/branch row into the
   matching `ai.rules.ts` function; `null` returns are filtered out.
6. Anomaly detection reuses the Timeline's trailing 11 **complete** months
   (excluding the still-in-progress current month) as its baseline series —
   a fixed, documented simplification independent of the display `period`.
7. Logs the resulting `Insight[]` to `AIInsightLog`, idempotently per
   calendar day, and returns them.

`getRiskAssessmentService` / `getOpportunitiesService` /
`getRecommendationsService` / `getAnomaliesService` are thin category filters
over that **one** shared call — never a second independent recomputation, so
a dashboard page needing multiple categories in one view doesn't pay for the
underlying engines twice.

## Recommendation Logic

- `expandHighPerformingBranchRecommendation` — fires when a branch's Health
  Score ≥ 80 (Multi-Branch view's `bestPerforming`).
- `delayLowReturnInvestmentRecommendations` — fires per project with
  `npv < 0` (Investment Portfolio's `needsAttention`).

Both reference the exact metric that triggered them in `supportingMetrics`.

## Risk Detection Logic

| Rule | Trigger | Severity |
|---|---|---|
| Falling Profitability | Net Profit trend down, \|Δ%\| ≥ 5 | high / critical ≥20% |
| Rising Cost (Food/Labour) | trend up, Δ% ≥ 5 | medium/high/critical by magnitude |
| Low Forecast Confidence | Forecast's own `overallConfidence === "low"` | medium |
| Delayed Investment Payback | negative NPV or no payback period | medium |
| Persistent Budget Miss | Budget Variance row status `"critical"` | critical |
| Declining Customer Growth | Customer Growth % < 0 | low → critical by magnitude (the one rule that reaches "low", by design — see *Design Decisions*) |
| Branch Underperforming Peers | Health Score gap ≥ 15 vs network average | medium/high/critical |
| Weak Business Health | overall Health Score < 50 | high/critical |

## Opportunity Detection Logic

| Rule | Trigger |
|---|---|
| High-Growth Branch | Multi-Branch's `mostImproved`, revenue trend ≥ 5% |
| Strong ROI Investment | Portfolio's `topPerforming`, ROI% > 20 |
| Improving Forecast Trend | Forecast's revenue KPI trending up ≥ 5% |
| Healthy Margin | EBITDA % achievement ≥ 110% of target |

## Anomaly Detection Logic

`detectAnomaly(label, kpiKey, unit, historicalValues, currentValue, higherIsBetter, relatedScreens)`:
`deviation = (current − mean) / stdDev` of the trailing series; flagged when
`|deviation| ≥ 1.5`, escalating to `high` at `≥2` and `critical` at `≥2.5`.
Requires ≥3 historical points and non-zero variance. Confidence reuses
Forecast's own `computeConfidence` heuristic (Phase 5) applied to the same
trailing series — not a new confidence formula.

## APIs Added

All under `/api/ai/:restaurantId/…`, `authMiddleware` + `requireOwnRestaurant()`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/insights` | Full categorized Insight list |
| GET | `/risks` \| `/opportunities` \| `/recommendations` \| `/anomalies` | Category filters over the same insight set |
| GET | `/insight-timeline` | Historical Insight Timeline (`AIInsightLog` rows) |
| GET | `/executive-brief` | Executive AI Brief |
| GET | `/branch-narratives` | Branch AI Insights |
| GET | `/ask/why-profit-changed` | "Why did profit decrease?" |
| GET | `/ask/best-performing-branch` | "Which branch performed best?" |
| GET | `/ask/why-food-cost-changing` | "Why is Food Cost increasing?" |
| GET | `/ask/best-roi-investments` | "What investments have the best ROI?" |
| GET | `/ask/what-if-sales-increase?percentage=10` | "What happens if sales increase by 10%?" — reuses Scenario's live-override mechanism (Phase 4) directly |
| GET | `/ask/kpis-needing-attention` | "Which KPIs need immediate attention?" |

The Conversational Finance API is plain, synchronous, deterministic service
functions returning a structured `ConversationalAnswer` — no LLM call, no
NLP layer. A future model (OpenAI, Anthropic, Gemini, etc.) can call these
same endpoints as tools/functions with zero architectural change.

## Dashboard Changes

New page `/dashboard/ai-advisor` ("AI Financial Advisor" in the sidebar,
between Executive Dashboard and Stock Audit), with 6 tabs reusing the
Executive Dashboard's tabbed-page shell: **Executive Brief**, **Insights**
(category-filterable — Insight/Risk/Opportunity/Recommendation/Anomaly, one
fetch, client-side filter), **Branch Narratives**, **Ask AI**, **Timeline**
(reuses Executive's own `TrendChart` component plus the Historical Insight
Timeline), **Reports**.

## Reports Added

6 report types in the Reports tab, each exportable to PDF (jsPDF +
jspdf-autotable), Excel (ExcelJS), CSV, and Print — the exact export
pipeline already used by every prior phase's Reports tab, not reimplemented:
AI Executive Report, Business Insight Report, Risk Assessment Report,
Opportunity Report, Branch AI Report, Weekly Executive Summary.

## Tests Added

- `ai.rules.test.ts` — 32 tests, one per rule function, asserting summary
  text contains the exact real numbers passed in, and that all 4 risk
  severity tiers (including "low") are reachable.
- `ai.validation.test.ts` — 4 tests for the validation layer.
- `ai.integration.test.ts` — 8 tests against the real configured database
  (isolated fixture restaurant, cleaned up in `afterAll`), verifying:
  a Revenue Increased insight's summary contains the fixture's exact
  ₹2,000/₹1,000 figures; category filters are pure subsets of the shared
  insight list; the Executive Brief composes correctly; Branch Narratives
  name the real branch; the "best-performing branch" answer is correct;
  the "why did profit change" decomposition is traceable; the "what if
  sales increase 10%" answer matches `2000 × 1.10 = 2200`; and same-day
  insight logging is idempotent (second call adds no new `AIInsightLog` rows).

Full suite: **233/233 unit tests passing**, **8/8 integration tests passing**.

## Performance Improvements

Live verification against a real 17,340-bill, 3-branch restaurant initially
**timed out** (`connection timeout exceeded`) — not from anything specific to
this phase's new code, but because `generateInsightsService`'s original
Promise.all stacked 5 already-heavy Phase 7 calls concurrently, and Executive
Timeline alone fans out into 12 internal concurrent per-month queries. Two
fixes, both config/orchestration-level (no engine formula touched):

1. `src/config/prisma.ts` — pg pool `max: 10 → 20`,
   `connectionTimeoutMillis: 3000 → 10000`. Benefits every module, not just AI.
2. `ai.service.ts` — `getExecutiveTimelineService` is now awaited on its own,
   after the other 4 concurrent calls resolve, instead of being stacked into
   the same `Promise.all`. Verified fix: the same real restaurant that timed
   out now completes in full, producing real, non-fabricated insights.

## Files Modified

**Backend (new):**
`prisma/migrations/20260729010000_add_ai_insight_log/migration.sql`,
`src/modules/ai/ai.types.ts`, `ai.rules.ts`, `ai.rules.test.ts`,
`ai.service.ts`, `ai.validation.ts`, `ai.validation.test.ts`,
`ai.controller.ts`, `ai.routes.ts`, `ai.integration.test.ts`.

**Backend (modified):**
`prisma/schema.prisma` (added `AIInsightLog` model + back-relations),
`src/routes/index.ts` (registered `/api/ai`), `src/config/prisma.ts` (pool
sizing), `src/modules/executive/executive.service.ts` (two additive field
extensions — `avgOrderValue`/`repeatCustomerRate` on Multi-Branch rows,
`foodCostPercentage`/`labourCostPercentage` on Timeline points — both reused
from data that function already fetched, no new query).

**Frontend (new):**
`src/pages/ai/aiCategories.ts`, `InsightCard.tsx`, `InsightsTab.tsx`,
`BriefTab.tsx`, `BranchNarrativesTab.tsx`, `AskTab.tsx`, `TimelineTab.tsx`,
`ReportsTab.tsx`, `AIAdvisorDashboard.tsx`.

**Frontend (modified):**
`src/routes/AppRoutes.tsx` (route), `src/layouts/DashboardLayout.tsx` (nav entry).

## Design Decisions

- **One shared `generateInsightsService` call, filtered by category
  downstream** — rather than 5 independent re-computations for
  Insights/Risks/Opportunities/Recommendations/Anomalies, avoiding N-times
  redundant engine calls when a dashboard view needs more than one category.
- **Severity scale includes "info"** for positive/neutral facts (a revenue
  increase, an anomalous improvement) so the spec's explicit Low/Medium/
  High/Critical 4-tier risk ask can be satisfied purely by filtering to
  risk-category insights (which never use "info").
- **`decliningCustomerGrowthRisk` was added specifically** to (a) cover the
  spec's explicit "declining customer growth" example and (b) be the one
  rule whose lowest band naturally reaches "low" severity — solving both
  with one addition rather than retrofitting arbitrary low bands elsewhere.
- **Confidence sourcing is never invented**: factual insights are always
  `"high"` (arithmetic on real historical numbers); forecast-based insights
  inherit the Forecast Engine's own `overallConfidence` verbatim; anomaly
  insights reuse Forecast's `computeConfidence` heuristic on their own
  trailing series. Three distinct, all-reused rules — no new confidence
  formula.
- **`AIInsightLog` is an audit log, not a financial data store** — it
  freezes a rendered insight (title/summary/severity/supportingMetrics as
  JSON) purely for the Historical Insight Timeline. Idempotent per calendar
  day via a `logDate` floored to midnight, checked with `findFirst`-then-
  `create` (no DB unique constraint, since `branchId` is nullable and
  Postgres treats `NULL ≠ NULL` in uniqueness checks — the same precedent as
  `FinancialAssumptions`/`ExecutiveKpiTarget`).
- **"Why did profit change" reconstructs cost amounts from already-computed
  percentages** (`foodCostAmount ≈ foodCostPercentage/100 × revenue`, using
  each KPI row's own `current`/`previousPeriod` values) to rank Revenue vs.
  Food Cost vs. Labour Cost as the biggest driver. This is a presentation-
  layer recombination of two real, already-computed numbers — not a new
  financial calculation — mirroring the level of derivation already used for
  Investment's Forecast-comparison feature (Phase 6).
- **Anomaly baseline is always monthly-granularity**, independent of the
  requested display `period` — a deliberate simplification so anomaly
  comparisons stay stable regardless of which period a user has selected for
  the Overview.

## Final Validation Checklist

- [x] Backend builds clean (`npm run build`)
- [x] Frontend builds clean (`npm run build`)
- [x] All unit tests pass (233/233)
- [x] All integration tests pass (8/8, real DB, isolated fixtures)
- [x] Every insight verified against real sample data (restaurant id 12,
      17,340 bills, 3 branches) — numbers match hand-computed expectations
      (e.g. revenue variance 22.1% = (3,885,596 − 3,025,361) / 3,885,596)
- [x] No AI output invents financial information — every summary/answer
      traced to `supportingMetrics`, which are themselves lifted verbatim
      from an existing engine's return value
- [x] Every recommendation references an existing metric
- [x] All calculations continue from the existing Finance Engine — no new
      calculation engine introduced
- [x] No duplicate calculations — two additive, zero-new-query extensions to
      `executive.service.ts` were the only changes to a prior phase's engine
- [x] Extensible for future LLM integration — the Conversational Finance API
      is a plain structured-service layer any model can call as tools
- [ ] Playwright browser verification — **not available in this session**
      (no browser-automation tool present); substituted with a clean
      frontend build/typecheck plus live HTTP verification of every new
      endpoint through the running dev backend with a real JWT (see
      *Performance Improvements* for the real-data run) and a clean
      `npx tsc --noEmit` frontend check.
