import { IngestPayload, ProcurementAvailability } from "./procurement.types";

const ALLOWED_AVAILABILITY: ProcurementAvailability[] = [
  "IN_STOCK",
  "LIMITED_STOCK",
  "OUT_OF_STOCK",
  "UNKNOWN",
];

export class ValidationError extends Error {}

export const validateSearchTerm = (term: unknown): string => {
  if (typeof term !== "string" || !term.trim()) {
    throw new ValidationError("Query param 'term' is required");
  }
  return term.trim().toLowerCase();
};

export const validateDays = (days: unknown): number => {
  if (days === undefined) return 30;
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0 || n > 365) {
    throw new ValidationError("Query param 'days' must be a number between 1 and 365");
  }
  return Math.floor(n);
};

export const validateIngestPayload = (body: any): IngestPayload => {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Request body is required");
  }
  const { supplierCode, searchTerm, city, currency, results } = body;

  if (typeof supplierCode !== "string" || !supplierCode.trim()) {
    throw new ValidationError("'supplierCode' is required");
  }
  if (typeof searchTerm !== "string" || !searchTerm.trim()) {
    throw new ValidationError("'searchTerm' is required");
  }
  if (!Array.isArray(results) || results.length === 0) {
    throw new ValidationError("'results' must be a non-empty array");
  }

  results.forEach((r, i) => {
    if (!r || typeof r !== "object") {
      throw new ValidationError(`results[${i}] must be an object`);
    }
    if (typeof r.productName !== "string" || !r.productName.trim()) {
      throw new ValidationError(`results[${i}].productName is required`);
    }
    if (typeof r.price !== "number" || !Number.isFinite(r.price) || r.price <= 0) {
      throw new ValidationError(`results[${i}].price must be a positive number`);
    }
    if (typeof r.unit !== "string" || !r.unit.trim()) {
      throw new ValidationError(`results[${i}].unit is required`);
    }
    if (
      r.availability !== undefined &&
      !ALLOWED_AVAILABILITY.includes(r.availability)
    ) {
      throw new ValidationError(
        `results[${i}].availability must be one of ${ALLOWED_AVAILABILITY.join(", ")}`,
      );
    }
  });

  return {
    supplierCode: supplierCode.trim().toUpperCase(),
    searchTerm: searchTerm.trim().toLowerCase(),
    city: typeof city === "string" && city.trim() ? city.trim().toLowerCase() : undefined,
    currency: typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase() : undefined,
    results,
  };
};
