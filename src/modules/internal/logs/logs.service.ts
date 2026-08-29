import prisma from "../../../config/prisma";
import { notFound } from "../shared/apiError";
import { parsePage, toPaged } from "../shared/pagination";

/**
 * Application log search.
 *
 * Searchable by the things an engineer actually has in hand: the correlation id
 * an employee quoted from an error message, a restaurant or order id from a
 * ticket, a route, or a time window.
 *
 * Only failures are recorded (see ApplicationLog in the schema), so this is a
 * list of what went wrong rather than a request trace. It does not replace
 * infrastructure logging — the host still has stdout, and this table holds
 * nothing from the restaurant apps, only the internal API.
 */

export interface LogQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  correlationId?: string;
  level?: string;
  restaurantId?: number;
  orderId?: number;
  actorEmail?: string;
  from?: string;
  to?: string;
}

export const listLogs = async (query: LogQuery) => {
  const page = parsePage(query);
  const filters: any[] = [];

  if (query.search?.trim()) {
    const term = query.search.trim();
    const or: any[] = [
      { correlationId: { contains: term, mode: "insensitive" } },
      { message: { contains: term, mode: "insensitive" } },
      { path: { contains: term, mode: "insensitive" } },
      { actorEmail: { contains: term, mode: "insensitive" } },
    ];
    // The identifiers get pasted in as displayed, so accept them that way.
    const res = term.match(/^res-(\d+)$/i);
    const ord = term.match(/^(?:ord|txn)-(\d+)$/i);
    if (res) or.push({ restaurantId: Number(res[1]) });
    if (ord) or.push({ orderId: Number(ord[1]) });
    filters.push({ OR: or });
  }
  if (query.correlationId) filters.push({ correlationId: query.correlationId.trim() });
  if (query.level) filters.push({ level: query.level });
  if (query.restaurantId) filters.push({ restaurantId: Number(query.restaurantId) });
  if (query.orderId) filters.push({ orderId: Number(query.orderId) });
  if (query.actorEmail) filters.push({ actorEmail: { contains: query.actorEmail, mode: "insensitive" } });
  if (query.from || query.to) {
    const createdAt: any = {};
    if (query.from) createdAt.gte = new Date(query.from);
    if (query.to) createdAt.lte = new Date(`${query.to}T23:59:59.999Z`);
    filters.push({ createdAt });
  }

  const where = filters.length ? { AND: filters } : {};

  const [rows, total] = await Promise.all([
    prisma.applicationLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: page.skip,
      take: page.take,
      // The stack is deliberately excluded from the list — it's large, and a
      // list of fifty stacks is unreadable. It's on the detail view.
      select: {
        id: true, correlationId: true, level: true, service: true, method: true, path: true,
        statusCode: true, message: true, actorEmail: true, restaurantId: true, orderId: true, createdAt: true,
      },
    }),
    prisma.applicationLog.count({ where }),
  ]);

  return toPaged(rows, total, page);
};

export const getLog = async (id: number) => {
  const log = await prisma.applicationLog.findUnique({ where: { id } });
  if (!log) throw notFound("No log entry with that id.", "LOG_NOT_FOUND");

  // Everything else that failed in the same request chain.
  const related = await prisma.applicationLog.findMany({
    where: { correlationId: log.correlationId, id: { not: log.id } },
    orderBy: { createdAt: "asc" },
  });

  return { ...log, related };
};

/** Distinct services and levels present, so the filters reflect reality. */
export const getLogMeta = async () => {
  const [levels, services] = await Promise.all([
    prisma.applicationLog.findMany({ distinct: ["level"], select: { level: true }, take: 20 }),
    prisma.applicationLog.findMany({ distinct: ["service"], select: { service: true }, take: 20 }),
  ]);
  return { levels: levels.map((l) => l.level), services: services.map((s) => s.service) };
};
