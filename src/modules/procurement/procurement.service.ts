import prisma from "../../config/prisma";
import { ValidationError } from "./procurement.validation";
import {
  HistoryPoint,
  IngestPayload,
  PriceComparisonRow,
  ProcurementAvailability,
} from "./procurement.types";

// MVP scope is fixed to these three supplier platforms — adding a new one
// later is just another entry here plus a Chrome-extension release, no
// schema or query changes (see procurement architecture doc).
const FIXED_SUPPLIERS: { code: string; displayName: string }[] = [
  { code: "HYPERPURE", displayName: "Hyperpure" },
  { code: "ZEPTO_BUSINESS", displayName: "Zepto Business" },
  { code: "INSTAMART", displayName: "Instamart" },
];

// Self-healing seed: called on every read so the API works out of the box
// without depending on someone remembering to run `npm run seed`.
const ensureSuppliersSeeded = async () => {
  await Promise.all(
    FIXED_SUPPLIERS.map((s) =>
      prisma.supplier.upsert({
        where: { code: s.code },
        update: {},
        create: { code: s.code, displayName: s.displayName },
      }),
    ),
  );
};

export const listActiveSuppliersService = async () => {
  await ensureSuppliersSeeded();
  return prisma.supplier.findMany({
    where: { isActive: true },
    orderBy: { displayName: "asc" },
  });
};

// ── Deterministic mock data ──────────────────────────────────────────────
// No live ingestion pipeline exists yet (Chrome extension is a later task),
// so reads fall back to placeholder data when no real snapshot has ever been
// captured for a term. It's deterministic (hashed from supplier+term) so a
// given search always renders the same numbers instead of jumping around on
// every request, and every mock row is explicitly flagged `source: "MOCK"`
// so nothing here can be mistaken for a real captured price.

const hashString = (input: string): number => {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
};

const COMMON_INGREDIENT_UNITS: Record<string, string> = {
  milk: "1 Litre",
  tomato: "1 kg",
  onion: "1 kg",
  paneer: "1 kg",
  rice: "1 kg",
  sugar: "1 kg",
  oil: "1 Litre",
  potato: "1 kg",
  flour: "1 kg",
  salt: "1 kg",
};

const basePriceForTerm = (term: string): number => {
  // Stable "plausible" base price per ingredient name, ₹20–₹120 range.
  return 20 + (hashString(term) % 100);
};

const unitForTerm = (term: string): string => COMMON_INGREDIENT_UNITS[term] || "1 kg";

const AVAILABILITY_CYCLE: ProcurementAvailability[] = [
  "IN_STOCK",
  "IN_STOCK",
  "IN_STOCK",
  "LIMITED_STOCK",
  "OUT_OF_STOCK",
];

const buildMockComparisonRows = (
  suppliers: { id: number; code: string; displayName: string }[],
  term: string,
): PriceComparisonRow[] => {
  const base = basePriceForTerm(term);
  const unit = unitForTerm(term);
  const now = Date.now();

  return suppliers.map((s, idx) => {
    const seed = hashString(`${s.code}:${term}`);
    const variance = 0.85 + (seed % 30) / 100; // 0.85x – 1.14x
    const price = Math.round(base * variance * 100) / 100;
    const availability = AVAILABILITY_CYCLE[seed % AVAILABILITY_CYCLE.length];
    // Stagger "last updated" per supplier so it doesn't look artificially synced.
    const capturedAt = new Date(now - ((seed % 45) + idx) * 60_000);

    return {
      supplierId: s.id,
      supplierCode: s.code,
      supplierName: s.displayName,
      productName: `${term.charAt(0).toUpperCase()}${term.slice(1)}`,
      price,
      unit,
      availability,
      currency: "INR",
      capturedAt: capturedAt.toISOString(),
      source: "MOCK" as const,
    };
  });
};

const buildMockHistory = (
  suppliers: { code: string; displayName: string }[],
  term: string,
  days: number,
): HistoryPoint[] => {
  const base = basePriceForTerm(term);
  const points: HistoryPoint[] = [];
  const now = Date.now();

  suppliers.forEach((s) => {
    for (let d = days - 1; d >= 0; d--) {
      const seed = hashString(`${s.code}:${term}:${d}`);
      const variance = 0.9 + (seed % 20) / 100; // gentle day-to-day drift
      const price = Math.round(base * variance * 100) / 100;
      points.push({
        supplierCode: s.code,
        supplierName: s.displayName,
        capturedAt: new Date(now - d * 24 * 60 * 60 * 1000).toISOString(),
        price,
      });
    }
  });

  return points;
};

// ── Reads ─────────────────────────────────────────────────────────────────

export const getPriceComparisonService = async (term: string, city?: string) => {
  const suppliers = await listActiveSuppliersService();

  const snapshots = await prisma.procurementPriceSnapshot.findMany({
    where: {
      searchTerm: term,
      ...(city ? { city } : {}),
      supplier: { isActive: true },
    },
    include: { supplier: true },
    orderBy: { capturedAt: "desc" },
  });

  // Most recent snapshot per supplier.
  const latestBySupplier = new Map<number, (typeof snapshots)[number]>();
  for (const snap of snapshots) {
    if (!latestBySupplier.has(snap.supplierId)) {
      latestBySupplier.set(snap.supplierId, snap);
    }
  }

  const isMockData = latestBySupplier.size === 0;

  const results: PriceComparisonRow[] = isMockData
    ? buildMockComparisonRows(suppliers, term)
    : suppliers.map((s) => {
        const snap = latestBySupplier.get(s.id);
        if (!snap) {
          // A real snapshot exists for other suppliers but not this one yet —
          // still mock-fill just this row rather than hiding the supplier.
          return buildMockComparisonRows([s], term)[0];
        }
        return {
          supplierId: s.id,
          supplierCode: s.code,
          supplierName: s.displayName,
          productName: snap.productName,
          price: snap.price,
          unit: snap.unit,
          availability: snap.availability,
          currency: snap.currency,
          capturedAt: snap.capturedAt.toISOString(),
          source: "LIVE" as const,
        };
      });

  const cheapest = results.reduce<PriceComparisonRow | null>(
    (min, r) => (min === null || r.price < min.price ? r : min),
    null,
  );

  return {
    term,
    city: city ?? null,
    cheapestSupplierCode: cheapest?.supplierCode ?? null,
    results,
    isMockData,
  };
};

export const getPriceHistoryService = async (term: string, days: number) => {
  const suppliers = await listActiveSuppliersService();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const snapshots = await prisma.procurementPriceSnapshot.findMany({
    where: {
      searchTerm: term,
      capturedAt: { gte: since },
      supplier: { isActive: true },
    },
    include: { supplier: true },
    orderBy: { capturedAt: "asc" },
  });

  const isMockData = snapshots.length === 0;

  const points: HistoryPoint[] = isMockData
    ? buildMockHistory(suppliers, term, days)
    : snapshots.map((s) => ({
        supplierCode: s.supplier.code,
        supplierName: s.supplier.displayName,
        capturedAt: s.capturedAt.toISOString(),
        price: s.price,
      }));

  return { term, days, points, isMockData };
};

// ── Ingestion ─────────────────────────────────────────────────────────────
// Backend never triggers a scrape (see architecture doc §2) — it only ever
// receives already-normalized results and persists them. Accepts data for
// any single supplier per call, matching how the extension will POST one
// supplier's tab result at a time.

export const ingestSnapshotsService = async (
  payload: IngestPayload,
  capturedByRestaurantId?: number,
) => {
  const supplier = await prisma.supplier.findUnique({
    where: { code: payload.supplierCode },
  });
  if (!supplier) {
    throw new ValidationError(`Unknown supplier code '${payload.supplierCode}'`);
  }

  const rows = payload.results.map((r) => ({
    supplierId: supplier.id,
    searchTerm: payload.searchTerm,
    city: payload.city ?? null,
    productName: r.productName.trim(),
    price: r.price,
    unit: r.unit.trim(),
    availability: r.availability ?? "UNKNOWN",
    currency: payload.currency ?? "INR",
    sourceUrl: r.sourceUrl ?? null,
    capturedByRestaurantId: capturedByRestaurantId ?? null,
    capturedAt: r.capturedAt ? new Date(r.capturedAt) : new Date(),
  }));

  const created = await prisma.procurementPriceSnapshot.createMany({ data: rows });

  return { supplierCode: supplier.code, inserted: created.count };
};
