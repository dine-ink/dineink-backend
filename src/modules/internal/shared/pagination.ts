/**
 * Every internal list endpoint paginates and filters in the database, never in
 * the browser — the brief's performance rule, and the only thing that works
 * once a table has more rows than a page.
 */
export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export const parsePage = (query: any, defaultPageSize = DEFAULT_PAGE_SIZE): PageParams => {
  const page = Math.max(1, Number(query?.page) || 1);
  const requested = Number(query?.pageSize) || defaultPageSize;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, requested));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const toPaged = <T>(rows: T[], total: number, params: PageParams): Paged<T> => ({
  rows,
  total,
  page: params.page,
  pageSize: params.pageSize,
  totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
});

/**
 * Sorting is allowlisted rather than passed through: `orderBy` goes straight
 * into a Prisma query, so accepting an arbitrary field name from the client
 * lets it order by — and therefore probe — columns the endpoint never meant to
 * expose.
 */
export const parseSort = <T extends string>(
  query: any,
  allowed: readonly T[],
  fallback: T,
  fallbackDirection: "asc" | "desc" = "desc",
): { field: T; direction: "asc" | "desc" } => {
  const requested = String(query?.sortBy ?? "");
  const field = (allowed as readonly string[]).includes(requested) ? (requested as T) : fallback;
  const direction = String(query?.sortDir ?? "").toLowerCase() === "asc" ? "asc" : query?.sortDir ? "desc" : fallbackDirection;
  return { field, direction };
};
