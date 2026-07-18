// Canonical unit system: every quantity is stored as one of these three units,
// regardless of what unit a user typed it in as (grams, ml, kg, litres...).
// Entry screens can keep offering whichever unit is convenient for that
// context (e.g. grams for a recipe, kg for a bulk restock) — conversion into
// canonical happens once, at the point of writing to the database, so every
// downstream calculation (wastage, cost, consumption) can safely assume
// matching units without re-converting.

export type UnitKind = "mass" | "volume" | "count";

export const CANONICAL_UNIT: Record<UnitKind, string> = {
  mass: "Kg",
  volume: "Litre",
  count: "Piece",
};

type UnitInfo = { kind: UnitKind; toCanonical: number };

// factor is "multiply a quantity in this unit by `toCanonical` to get the
// canonical-unit quantity" (e.g. 500 gram * (1/1000) = 0.5 Kg).
const UNIT_TABLE: Record<string, UnitInfo> = {
  kg: { kind: "mass", toCanonical: 1 },
  kilogram: { kind: "mass", toCanonical: 1 },
  kilograms: { kind: "mass", toCanonical: 1 },
  gram: { kind: "mass", toCanonical: 1 / 1000 },
  grams: { kind: "mass", toCanonical: 1 / 1000 },
  gm: { kind: "mass", toCanonical: 1 / 1000 },
  g: { kind: "mass", toCanonical: 1 / 1000 },

  litre: { kind: "volume", toCanonical: 1 },
  liter: { kind: "volume", toCanonical: 1 },
  litres: { kind: "volume", toCanonical: 1 },
  liters: { kind: "volume", toCanonical: 1 },
  l: { kind: "volume", toCanonical: 1 },
  ml: { kind: "volume", toCanonical: 1 / 1000 },
  millilitre: { kind: "volume", toCanonical: 1 / 1000 },
  milliliter: { kind: "volume", toCanonical: 1 / 1000 },
  millilitres: { kind: "volume", toCanonical: 1 / 1000 },

  piece: { kind: "count", toCanonical: 1 },
  pieces: { kind: "count", toCanonical: 1 },
  pc: { kind: "count", toCanonical: 1 },
  pcs: { kind: "count", toCanonical: 1 },
  unit: { kind: "count", toCanonical: 1 },
  units: { kind: "count", toCanonical: 1 },
};

export const classifyUnit = (raw?: string | null): (UnitInfo & { canonical: string }) | null => {
  const key = (raw || "").trim().toLowerCase();
  const entry = UNIT_TABLE[key];
  if (!entry) return null;
  return { ...entry, canonical: CANONICAL_UNIT[entry.kind] };
};

export const isCanonicalUnit = (raw?: string | null) =>
  Object.values(CANONICAL_UNIT).includes((raw || "").trim());

/**
 * Converts a quantity from whatever unit it's currently in to the canonical
 * unit for that unit's kind (mass -> Kg, volume -> Litre, count -> Piece).
 * Returns null if the unit string isn't recognized at all — callers should
 * treat that as "can't safely convert" rather than silently guessing.
 */
export const toCanonicalQty = (
  qty: number,
  unit?: string | null,
): { qty: number; unit: string } | null => {
  const info = classifyUnit(unit);
  if (!info) return null;
  return { qty: qty * info.toCanonical, unit: info.canonical };
};

/**
 * Converts a *price per unit* the opposite direction of a quantity — e.g.
 * "₹2 per gram" becomes "₹2000 per Kg" (divide by the same factor a
 * quantity would be multiplied by).
 */
export const toCanonicalPricePerUnit = (
  pricePerUnit: number,
  unit?: string | null,
): number | null => {
  const info = classifyUnit(unit);
  if (!info) return null;
  return pricePerUnit / info.toCanonical;
};

/**
 * Display-side formatter: takes a quantity already stored in its canonical
 * unit and auto-scales it to whichever human-friendly unit reads best (e.g.
 * 0.25 Kg -> "250 g", 2.5 Kg -> "2.5 Kg"), independent of how it was entered.
 */
export const formatCanonicalQty = (qty: number, canonicalUnit: string): string => {
  const n = Number(qty) || 0;
  const trimmed = (v: number) =>
    v % 1 === 0 ? String(v) : v.toFixed(v < 10 ? 3 : 1).replace(/\.?0+$/, "");

  if (canonicalUnit === "Kg" && Math.abs(n) < 1) return `${trimmed(n * 1000)} g`;
  if (canonicalUnit === "Litre" && Math.abs(n) < 1) return `${trimmed(n * 1000)} ml`;
  return `${trimmed(n)} ${canonicalUnit}`;
};
