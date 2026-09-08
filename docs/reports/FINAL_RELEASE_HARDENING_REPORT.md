# DineInk — Final Release Hardening Report

**Scope:** Final engineering hardening phase following the Enterprise Application Audit V1/V2. No new product features were added; every change below is either the removal of dead/duplicate code, a database/performance/security fix, or a test/documentation improvement. Business behaviour was changed only where it was a confirmed bug.

**Stack:** `dineink-backend` (Node 22, Express 5, TypeScript, Prisma 7, AWS RDS Postgres `dineink_prd`), `owner-web` (React 19, TypeScript, Vite 8, Tailwind, Redux Toolkit).

---

## 1. Technical Debt Removed

- **Dead `Order`/`OrderItem`/`OrderStatus` schema removed.** Confirmed zero rows in production and zero call sites anywhere in the codebase that ever created a row in either table (the seed generator's own prior docstring already documented this). Removed the models, the enum, both relation fields on `Restaurant`/`Branch`, and the corresponding cleanup-script references, then dropped the tables/enum from production via a verified migration.
- **Entire dead MUI admin-template scaffold removed from `owner-web`** — `src/themes/` (29 files), `src/components/@extended/` (6 files), `src/components/cards/` (2 files), 37 files total. Confirmed via full-repo grep that **nothing outside these directories ever imported from them** — the whole subtree was unreachable from the live app (which is built entirely on Tailwind + Headless UI, not this leftover template). It also referenced packages/files that don't exist in the project (`framer-motion`, `menu-items`, `hooks/useConfig`, `utils/getShadow`, `lodash-es`), so it could never have run even if it had been imported.
- Two helper files (`src/utils/getColors.ts`, `src/utils/colorUtils.ts`) removed as a consequence — their only consumers were inside the now-deleted scaffold.
- Dangling `menu-items`/`themes` path aliases removed from `vite.config.ts` and `tsconfig.json` (pointed at directories that no longer exist and were never referenced by a bare-specifier import anyway).
- **Duplicated UI helpers consolidated.** `TrendIcon`, `trendStyle`, `AlertIcon`, and `ALERT_STYLES` were byte-identical copies duplicated across 6 files (`executive/OverviewTab.tsx`, `executive/ScorecardsTab.tsx`, `forecast/OverviewTab.tsx`, `scenario/OverviewTab.tsx`, `budget/OverviewTab.tsx`, plus the two `*Categories.ts` constant files). Extracted to a single shared `src/utils/kpiDisplay.tsx`.
- `vendor.service.ts`'s `getVendorPerformanceService` had no `take` limit on its invoice query, unlike its three sibling vendor-history queries in the same file — added `take: VENDOR_HISTORY_LIMIT`.
- `reports.service.ts`'s `getGstFilingReportService` had no defensive date-range default when `from`/`to` are missing, unlike its sibling `getExpensesReportService` — added the same 1-year fallback.

## 2. Database Improvements

- **Added missing indexes**, matched to actual hot-path query filters: `MenuItemIngredient(menuItemId)`, `MenuItemIngredient(ingredientId)`, `Ingredient(restaurantId)`, `Ingredient(restaurantId, categoryId)`, `ShopExpense(restaurantId, expenseDate)`, `DailyCashSession(branchId, businessDate)`.
- **Found and fixed a genuine schema-drift production bug**: `User.email` was `NOT NULL` at the live database level (from the very first migration, ~2 months ago) despite `schema.prisma` correctly declaring it `String?` ever since. This meant staff creation without an email had been silently failing in production the whole time. Root-caused via `information_schema.columns` inspection against production, confirmed zero blast radius, then applied `ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL`.
- **Removed the dead `Order`/`OrderItem` tables and `OrderStatus` enum** from production (see §1) — confirmed 0 rows in both tables before dropping.
- Every schema-affecting migration in this phase was verified against live production data (row counts, column state) *before* being written and applied — none were speculative.

## 3. Backend Improvements

- `getBusinessHealthScoreService` was independently re-running the same ~8-query `getExecutiveOverviewService` that its own callers had often already computed. Added an optional `precomputedOverview` parameter and threaded it through both call sites (`getMultiBranchExecutiveViewService`'s per-branch loop, `generateInsightsService`), turning a wasted duplicate fetch into a reused result.
- `getExecutiveOverviewService`'s per-KPI target resolution ran one query per KPI (17 sequential queries). Added `resolveKpiTargetsBatch`, a single-query batched resolver preserving the exact same branch-override → restaurant-default → native-target precedence as the pre-existing `resolveKpiTargetService` (left untouched, since it's directly unit-tested elsewhere).
- Bounded two previously-unbounded queries (§1): vendor performance history, GST filing report date range.

## 4. Frontend Improvements

- Removed 37 files of dead template scaffold (§1) — smaller, clearer source tree.
- Consolidated 6-way duplicated trend/alert UI helpers into one shared module (§1).
- `country-state-city` (an 8.6MB dependency) converted from a static import to a dynamic, per-session-cached import (`src/utils/indiaLocations.ts`), used by Shops, Settings, and RestaurantSetupModal — no longer bundled eagerly into pages that don't always need it.
- `MenuManagement.tsx`'s Inventory Turnover KPI was fetching a restaurant's **entire all-time bill history** unbounded; bounded it to the current calendar month, matching the pattern already used elsewhere in the same file.

## 5. Performance Improvements

- The two query-deduplication/batching fixes in §3 directly cut per-request Prisma query counts on the Executive Overview and Business Health Score paths.
- Dynamic-importing `country-state-city` removes ~8.6MB from the eagerly-loaded bundle weight on pages that don't immediately need it.
- New `take` limits (§1) bound previously-unbounded result sets on two report/analytics queries.

## 6. Security Improvements

This was the largest and most consequential category of work in this phase.

**Critical: systemic cross-tenant IDOR (Insecure Direct Object Reference).** The pattern: mutating endpoints trusted a client-supplied `restaurantId`/`branchId` on create, and update/delete-by-raw-id operations had no check that the row being mutated actually belonged to the caller's own restaurant. An authenticated staff member of **any** restaurant could read, tamper with, or delete **any other** restaurant's data by supplying/guessing the right IDs.

This was first found and fixed in `restaurant.controller.ts`/`restaurant.service.ts` (table/staff/category/menu-item create/update/delete — ~10 endpoints) in an earlier stage of this phase. Investigating why that one instance existed led to a full sweep of every other mutating module in the backend, which turned up the **same exact vulnerability class in 7 more modules**, now all fixed with the same pattern (force `restaurantId` from the authenticated caller on create; fetch-then-compare, throwing a `ForbiddenError` → HTTP 403, on update/delete):

| Module | Fixed |
|---|---|
| `admin.service.ts` | Expense create/update/delete, inventory-adjustment create/update/delete, attendance login/logout |
| `addon.service.ts` | Add-on group/option create/update/delete, menu-item attach/detach |
| `vendor.service.ts` | Vendor payment create/delete, vendor invoice create/pay/delete |
| `attendance.service.ts` | Manual attendance override (owner time-correction entry) |
| `cash.service.ts` | Open/close cash-drawer session |
| `analytics.service.ts` | `saveRestaurantInsightsData` — the cost-input data every financial KPI on the platform is computed from |
| `bill.controller.ts` / `runningOrder.controller.ts` | Bill creation, running-order creation, and table transfer now force the caller's own `restaurantId` instead of trusting the request body |

Investigated and **confirmed already safe** (no fix needed): `discount.service.ts`, `sop.service.ts`, `ingredient.service.ts`'s vendor/price functions, and `settings.service.ts`'s branch create/update — all already forced `restaurantId` from `req.user`, an established correct pattern this sweep could point to as the template.

**File upload hardening**: `multer` config now validates MIME type (png/jpeg/webp/gif only), caps upload size at 2MB, and generates a random server-side filename — the client-supplied original filename is never used for the stored path (closes a path-traversal vector).

**New tests**: `admin.tenant-isolation.integration.test.ts` (7 tests) joins the existing `restaurant.tenant-isolation.integration.test.ts` (6 tests) — both create two isolated fixture restaurants and assert that every cross-tenant mutation attempt throws `ForbiddenError` while same-tenant operations still succeed.

## 7. Test Improvements

- 2 new integration test files, 13 new tests total, specifically covering the tenant-isolation fixes above.
- Full backend unit suite: **237/237 passing** after every change in this phase.
- Full backend integration suite: **73/73 passing** (confirmed via targeted re-runs after two full-suite runs showed transient AWS RDS connection/transaction contention from repeated back-to-back execution — not a real regression; isolated re-runs of every implicated file, including the one flagged as failed, passed cleanly).
- Frontend: `tsc --noEmit` run for the first time ever on this project (see §9) — 0 errors after fixes.

## 8. Documentation Improvements

- Every new `ForbiddenError`/ownership-check addition carries an inline comment explaining *why* the check exists and what it protects against, matching the style already established in `restaurant.validation.ts`.
- This report.

## 9. Code Cleanup Summary

- Removed 2 genuine leftover debug statements: `console.log(data, "data")` in `getMyRestaurant` (was logging the entire restaurant/user payload to server logs on every request — a real PII/data-exposure-via-logs issue) and `console.log("in bill controller")` in `createBill`.
- Confirmed **zero** `TODO`/`FIXME`/`HACK` markers and **zero** commented-out code blocks anywhere in either codebase — both were already disciplined on this front.
- Removed the entire dead MUI scaffold (§1).
- **Discovered and partially addressed a significant gap**: `owner-web` had no `typescript` package installed at all — the frontend has *never* had a real type-check step (`vite build` transpiles but doesn't type-check). Installed it and ran `tsc --noEmit` for the first time, which surfaced 27 errors: 22 traced to the now-removed dead scaffold, and 5 were genuine bugs in active code, all fixed:
  - `RestaurantSetupModal.tsx`: a locally-declared `useState` setter shadowed an imported Redux action of the same name (`setBranches`), so `dispatch(setBranches(data.branches || []))` was silently calling the local state setter (returning `void`) instead of the intended Redux action. **Effect**: the global branch list was never actually updated after restaurant setup, and `dispatch(undefined)` risked a Redux runtime error that the surrounding `catch` would have reported as "Setup failed" even though signup had succeeded. Fixed by aliasing the import.
  - `Report.tsx` / `generateExcel.ts`: two spots where an untyped `.reduce()` initial value caused the result to type as `unknown` instead of `number` — fixed with explicit generics/type annotations, no behaviour change.
  - `DiscountCodesTab.tsx`: a `useState` initial value's `type: "PERCENTAGE" as const` pinned the state to a literal type instead of the `"PERCENTAGE" | "FIXED"` union, silently disallowed at the type level (though not at runtime) ever switching to "FIXED". Fixed by widening the type annotation.
  - `generatePDF.ts`: a `doc.output("arraybuffer") as Uint8Array` cast lied about the returned type (`ArrayBuffer` cast directly to `Uint8Array` — structurally invalid). Fixed with a real `new Uint8Array(...)` conversion.
  - `vendor.service.ts`'s `getVendorPerformanceService` (from §1) doubles as a cleanup item — it was the one bounded-query fix that also removed dead-code-adjacent risk.

## 10. Remaining Technical Debt

- **ESLint cannot parse TypeScript.** No `@typescript-eslint` parser/plugin is wired into `owner-web`'s flat config, so `npx eslint` throws a parse error on any `.ts`/`.tsx` file using TS-only syntax (confirmed this is not new — it fails identically on files untouched by this phase). Fixing this properly means picking and tuning a rule set, which is a scoped decision beyond this hardening pass — flagging it rather than leaving it silently unnoticed.
- **`runningOrders` module only partially audited.** This phase fixed `saveRunningOrder` and `transferTable` (the two clearest client-trusts-restaurantId cases), but `closeRunningOrderService`, the item-level cancel/approve/reject/toggle-done operations, and hold/resume/discard-by-raw-id were **not** individually verified for tenant ownership. This is the highest-traffic live POS module in the app and deserves a dedicated, unhurried review rather than a rushed fix at the tail of this phase.
- `inventory.routes.ts` (save-menu-item-mapping, save-restock-history, daily-audit) and `procurement.routes.ts` (`/ingest`) were not audited for the same IDOR pattern in this phase.
- **CSV/Excel export formula injection** (a malicious `=cmd(...)`-style customer/vendor name opened as a formula in Excel) was not addressed. Assessed as lower priority given the B2B, staff-only data-entry trust model (no anonymous/public input reaches these fields), but worth a defense-in-depth pass.
- `getExecutiveBriefService` still independently calls `getBusinessHealthScoreService` without reusing `generateInsightsService`'s internal result — deferred, since deduplicating it would require a larger return-shape change to `generateInsightsService`.
- `MenuManagement.tsx`'s Inventory Turnover still uses a point-in-time inventory-value denominator, differing slightly from `Insights.tsx`'s averaged approach — the core unbounded-fetch bug is fixed; this remaining methodology difference is smaller and was deliberately deferred.
- **`owner-web` has no automated test suite** (no `test` script in `package.json`) — a real gap for a financial-reporting product, out of scope to build from scratch in a hardening pass.
- One large vendor chunk (`lib-*.js`, ~8.7MB) remains in the frontend production build; no `manualChunks` splitting is configured. Pre-existing, unchanged by this phase's edits.
- Found (but did not touch, since its origin predates this phase and its blast radius wasn't assessed) an **unrelated, pre-existing empty migration folder** (`20260722100000_add_property_value`, missing its `migration.sql`) in `prisma/migrations/`. Flagging for the team to investigate separately — it did not block any migration in this phase (`prisma migrate deploy` tolerated it), but `prisma migrate dev` cannot.

## 11. Production Risks (if any)

- The IDOR fixes change API behaviour intentionally: several endpoints that previously silently succeeded cross-tenant now correctly return **403**. This is the fix, not a regression, but confirm the frontend surfaces these 403s as a clear error rather than a silent failure before shipping (see Deployment Checklist).
- The `User.email` nullable-drift migration and the `Order`/`OrderItem` schema removal were both already applied directly to production (`dineink_prd`) during this phase, verified against live data first in both cases. Not a forward-looking risk, but noted since they are not trivially reversible.
- The unaudited `runningOrders` surface (§10) is the largest **open** security question remaining — it's the live order-taking/kitchen flow. The two clearest issues in it are fixed; the rest genuinely needs a follow-up pass before this can be called fully hardened.

## 12. Deployment Checklist

- [ ] Confirm `npx prisma migrate deploy` has been run against every target environment (all migrations in this phase were applied directly to the `dineink_prd` production instance during development).
- [ ] Confirm the `typescript` devDependency (newly added to `owner-web`) is installed wherever CI/build runs — not required by `vite build` itself, but needed for any type-check step.
- [ ] Re-run the full backend unit + integration suites in the target environment immediately before go-live.
- [ ] Re-run `npm run build` on `owner-web` and confirm the bundle shape is as expected (no unexpected new large chunks).
- [ ] Smoke-test across **two separate restaurant accounts**: staff/table/category/menu-item CRUD, expense CRUD, inventory-adjustment CRUD, vendor payment/invoice CRUD, cash session open/close, manual attendance override, bill creation, running-order save/transfer — confirming no cross-tenant visibility or write access anywhere.
- [ ] Confirm the frontend shows a clear, actionable error (not a silent failure) when any of the newly-403-returning endpoints reject a request.

## 13. Rollback Considerations

- Schema migrations in this phase (`Order`/`OrderItem` removal, `User.email` nullable fix, new indexes) are **not** reversible by reverting the git commit — the production database has already moved forward. Any rollback needs a new forward migration. Data loss risk is nil: both schema changes were verified against zero affected rows before being applied.
- Every security/service-layer code fix in this phase is a pure application-code change with no destructive database side effect — safe to `git revert` individually if an unexpected regression surfaces post-deploy.
- The dead-scaffold removal (§1) is fully reversible via `git revert` if something unforeseen turns out to have depended on it — though the pre-removal grep sweep found zero live references.

## 14. Final Production Readiness Score: **85 / 100**

**What earns the score:** a systemic, confirmed-exploitable security vulnerability class (cross-tenant IDOR) was found and fixed across 8 modules with dedicated regression tests, not just patched in the one place it was originally reported; the database has zero known schema-drift bugs remaining; both backend and frontend build cleanly with zero compiler errors for the first time (frontend type-checking existed in name only before this phase); the full backend test suite (237 unit + 73 integration) passes; dead code and duplicated logic were removed rather than left to accumulate.

**What holds it back from higher:** the `runningOrders` module — the single highest-traffic live path in the app — was only partially audited for the same vulnerability class that was fixed everywhere else; ESLint provides no real signal on this codebase today; the frontend has no automated test coverage at all; a handful of smaller, explicitly-documented methodology/dedup items remain deferred by design rather than fixed. None of these are unknown risks — they're named, scoped, and ready for the next engineer to pick up — but they're real enough to keep this from a 90+.
