export type ProcurementAvailability =
  | "IN_STOCK"
  | "LIMITED_STOCK"
  | "OUT_OF_STOCK"
  | "UNKNOWN";

export interface SupplierDTO {
  id: number;
  code: string;
  displayName: string;
  isActive: boolean;
  iconUrl: string | null;
}

// One supplier's price for a search term — either a real captured snapshot
// or a deterministic placeholder while no extension data has been ingested
// yet (source: "MOCK"). The shape is identical either way so the frontend
// never needs to branch on it.
export interface PriceComparisonRow {
  supplierId: number;
  supplierCode: string;
  supplierName: string;
  productName: string;
  price: number;
  unit: string;
  availability: ProcurementAvailability;
  currency: string;
  capturedAt: string;
  source: "LIVE" | "MOCK";
}

export interface PriceComparisonResponse {
  term: string;
  city: string | null;
  cheapestSupplierCode: string | null;
  results: PriceComparisonRow[];
  isMockData: boolean;
}

export interface HistoryPoint {
  supplierCode: string;
  supplierName: string;
  capturedAt: string;
  price: number;
}

export interface PriceHistoryResponse {
  term: string;
  days: number;
  points: HistoryPoint[];
  isMockData: boolean;
}

export interface IngestResultItem {
  productName: string;
  price: number;
  unit: string;
  availability?: ProcurementAvailability;
  sourceUrl?: string;
  capturedAt?: string;
}

export interface IngestPayload {
  supplierCode: string;
  searchTerm: string;
  city?: string;
  currency?: string;
  results: IngestResultItem[];
}
