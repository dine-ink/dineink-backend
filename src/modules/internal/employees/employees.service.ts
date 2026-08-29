import crypto from "crypto";
import bcrypt from "bcryptjs";
import prisma from "../../../config/prisma";
import { normalizeEmail } from "../../../utils/email";
import { AUDIT_ACTIONS, auditData, listAuditForResource } from "../audit/audit.service";
import { conflict, invalidState, notFound } from "../shared/apiError";
import { nextEmployeeCode } from "../shared/ids";
import { parsePage, parseSort, toPaged } from "../shared/pagination";

/**
 * Internal employee administration.
 *
 * The rule that shapes this module: **nobody can escalate their own access.**
 * An administrator with EMPLOYEE_UPDATE can change other people's roles, but
 * not their own, and cannot grant a role carrying permissions they don't hold
 * themselves. Without those two checks, EMPLOYEE_UPDATE quietly *is*
 * Super Admin — anyone holding it could assign themselves the Super Admin role
 * and have everything.
 */

const EMPLOYEE_SORT_FIELDS = ["createdAt", "name", "email", "lastLoginAt", "employeeCode"] as const;

export interface EmployeeListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  department?: string;
  roleId?: number;
  sortBy?: string;
  sortDir?: string;
}

export const listEmployees = async (query: EmployeeListQuery) => {
  const page = parsePage(query);
  const sort = parseSort(query, EMPLOYEE_SORT_FIELDS, "createdAt");

  const filters: any[] = [];
  if (query.search?.trim()) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
        { employeeCode: { contains: term, mode: "insensitive" } },
      ],
    });
  }
  if (query.status) filters.push({ status: query.status });
  if (query.department) filters.push({ department: query.department });
  if (query.roleId) filters.push({ roles: { some: { roleId: Number(query.roleId) } } });

  const where = filters.length ? { AND: filters } : {};

  const [rows, total] = await Promise.all([
    prisma.internalUser.findMany({
      where,
      orderBy: { [sort.field]: sort.direction },
      skip: page.skip,
      take: page.take,
      select: {
        id: true,
        employeeCode: true,
        name: true,
        email: true,
        phone: true,
        department: true,
        designation: true,
        status: true,
        twoFactorEnabled: true,
        lastLoginAt: true,
        createdAt: true,
        roles: { select: { role: { select: { id: true, key: true, name: true } } } },
      },
    }),
    prisma.internalUser.count({ where }),
  ]);

  return toPaged(
    rows.map((row) => ({ ...row, roles: row.roles.map((r) => r.role) })),
    total,
    page,
  );
};

export const getEmployee = async (employeeId: number) => {
  const employee = await prisma.internalUser.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      employeeCode: true,
      name: true,
      email: true,
      phone: true,
      department: true,
      designation: true,
      status: true,
      twoFactorEnabled: true,
      twoFactorRequired: true,
      mustChangePassword: true,
      lastLoginAt: true,
      lastLoginIp: true,
      lockedUntil: true,
      failedLoginCount: true,
      createdAt: true,
      updatedAt: true,
      roles: {
        select: {
          createdAt: true,
          role: { select: { id: true, key: true, name: true, permissions: { select: { permission: true } } } },
        },
      },
    },
  });
  if (!employee) throw notFound("Employee not found", "EMPLOYEE_NOT_FOUND");

  const permissions = Array.from(
    new Set(employee.roles.flatMap((r) => r.role.permissions.map((p) => p.permission))),
  ).sort();

  const sessions = await prisma.internalSession.findMany({
    where: { userId: employeeId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
  });

  return {
    ...employee,
    roles: employee.roles.map((r) => ({ ...r.role, permissions: undefined, grantedAt: r.createdAt })),
    permissions,
    sessions,
  };
};

/**
 * The permissions an actor holds, used to stop them handing out more than they
 * have. Read from the database rather than from the request context so a role
 * change made moments ago is already reflected.
 */
const permissionsOf = async (userId: number): Promise<Set<string>> => {
  const rows = await prisma.internalUserRole.findMany({
    where: { userId },
    select: { role: { select: { permissions: { select: { permission: true } } } } },
  });
  return new Set(rows.flatMap((r) => r.role.permissions.map((p) => p.permission)));
};

const assertCanGrantRoles = async (req: any, roleIds: number[]) => {
  if (!roleIds.length) return;
  const roles = await prisma.internalRole.findMany({
    where: { id: { in: roleIds } },
    select: { id: true, name: true, permissions: { select: { permission: true } } },
  });
  if (roles.length !== roleIds.length) {
    throw notFound("One of those roles doesn't exist.", "ROLE_NOT_FOUND");
  }

  const actorPermissions = await permissionsOf(req.internal.id);
  for (const role of roles) {
    const excess = role.permissions
      .map((p) => p.permission)
      .filter((permission) => !actorPermissions.has(permission));
    if (excess.length) {
      throw invalidState(
        `You can't grant "${role.name}" — it includes permissions you don't have yourself (${excess.slice(0, 3).join(", ")}${excess.length > 3 ? `, +${excess.length - 3} more` : ""}).`,
        "CANNOT_GRANT_EXCESS_PERMISSIONS",
      );
    }
  }
};

export interface CreateEmployeeInput {
  name: string;
  email: string;
  phone?: string | null;
  department?: string | null;
  designation?: string | null;
  roleIds: number[];
  twoFactorRequired?: boolean;
}

export const createEmployee = async (req: any, input: CreateEmployeeInput) => {
  const name = input.name?.trim();
  const email = normalizeEmail(input.email || "");
  if (!name) throw invalidState("Enter the employee's name.", "NAME_REQUIRED");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw invalidState("Enter a valid company email address.", "INVALID_EMAIL");
  }
  const roleIds = (input.roleIds ?? []).map(Number).filter(Boolean);
  if (!roleIds.length) throw invalidState("Give the employee at least one role.", "ROLE_REQUIRED");

  const existing = await prisma.internalUser.findUnique({ where: { email } });
  if (existing) throw conflict("An employee with that email already exists.", "EMPLOYEE_EXISTS");

  await assertCanGrantRoles(req, roleIds);

  // Generated and returned once. Not emailed and not chosen by the
  // administrator: mustChangePassword forces it to be replaced at first login,
  // so it only has to survive being read out once.
  const temporaryPassword = `${crypto.randomBytes(9).toString("base64url")}Aa1!`;

  const created = await prisma.$transaction(async (tx) => {
    const employee = await tx.internalUser.create({
      data: {
        employeeCode: await nextEmployeeCode(tx),
        name,
        email,
        phone: input.phone?.trim() || null,
        department: input.department?.trim() || null,
        designation: input.designation?.trim() || null,
        password: await bcrypt.hash(temporaryPassword, 10),
        status: "ACTIVE",
        mustChangePassword: true,
        twoFactorRequired: Boolean(input.twoFactorRequired),
        createdById: req.internal.id,
        roles: { create: roleIds.map((roleId) => ({ roleId, grantedById: req.internal.id })) },
      },
      select: { id: true, employeeCode: true, name: true, email: true },
    });

    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.EMPLOYEE_CREATED,
        resourceType: "InternalUser",
        resourceId: employee.id,
        resourceLabel: employee.email,
        newValue: { name, email, department: input.department ?? null, roleIds },
      }),
    });

    return employee;
  });

  return { ...created, temporaryPassword };
};

export const updateEmployee = async (req: any, employeeId: number, input: Record<string, any>) => {
  const before = await prisma.internalUser.findUnique({ where: { id: employeeId } });
  if (!before) throw notFound("Employee not found", "EMPLOYEE_NOT_FOUND");

  const data: Record<string, any> = {};
  for (const field of ["name", "phone", "department", "designation"]) {
    if (input[field] !== undefined) {
      const value = typeof input[field] === "string" ? input[field].trim() : input[field];
      data[field] = value === "" ? null : value;
    }
  }
  if (input.twoFactorRequired !== undefined) data.twoFactorRequired = Boolean(input.twoFactorRequired);
  if (data.name === null) throw invalidState("An employee must have a name.", "NAME_REQUIRED");
  if (!Object.keys(data).length) throw invalidState("Nothing to update.", "NO_CHANGES");

  const previous: Record<string, any> = {};
  for (const key of Object.keys(data)) previous[key] = (before as any)[key];

  const [updated] = await prisma.$transaction([
    prisma.internalUser.update({ where: { id: employeeId }, data }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.EMPLOYEE_UPDATED,
        resourceType: "InternalUser",
        resourceId: employeeId,
        resourceLabel: before.email,
        previousValue: previous,
        newValue: data,
      }),
    }),
  ]);

  return updated;
};

export const setEmployeeRoles = async (req: any, employeeId: number, roleIds: number[]) => {
  const employee = await prisma.internalUser.findUnique({
    where: { id: employeeId },
    include: { roles: { select: { roleId: true } } },
  });
  if (!employee) throw notFound("Employee not found", "EMPLOYEE_NOT_FOUND");

  // Without this, EMPLOYEE_UPDATE is a self-service route to Super Admin.
  if (employeeId === req.internal.id) {
    throw invalidState(
      "You can't change your own roles. Ask another administrator.",
      "CANNOT_CHANGE_OWN_ROLES",
    );
  }

  const nextRoleIds = [...new Set((roleIds ?? []).map(Number).filter(Boolean))];
  if (!nextRoleIds.length) {
    throw invalidState("An employee needs at least one role. Disable the account instead.", "ROLE_REQUIRED");
  }

  const previousRoleIds = employee.roles.map((r) => r.roleId);
  const added = nextRoleIds.filter((id) => !previousRoleIds.includes(id));
  await assertCanGrantRoles(req, added);

  await prisma.$transaction([
    prisma.internalUserRole.deleteMany({ where: { userId: employeeId, roleId: { notIn: nextRoleIds } } }),
    prisma.internalUserRole.createMany({
      data: added.map((roleId) => ({ userId: employeeId, roleId, grantedById: req.internal.id })),
      skipDuplicates: true,
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.EMPLOYEE_ROLES_CHANGED,
        resourceType: "InternalUser",
        resourceId: employeeId,
        resourceLabel: employee.email,
        previousValue: { roleIds: previousRoleIds },
        newValue: { roleIds: nextRoleIds },
      }),
    }),
  ]);

  return getEmployee(employeeId);
};

export const setEmployeeStatus = async (
  req: any,
  employeeId: number,
  status: "ACTIVE" | "DISABLED",
  reason?: string,
) => {
  const employee = await prisma.internalUser.findUnique({ where: { id: employeeId } });
  if (!employee) throw notFound("Employee not found", "EMPLOYEE_NOT_FOUND");
  if (employeeId === req.internal.id) {
    throw invalidState("You can't disable your own account.", "CANNOT_DISABLE_SELF");
  }
  if (employee.status === status) {
    throw invalidState(`${employee.name} is already ${status.toLowerCase()}.`, "NO_CHANGES");
  }
  if (status === "DISABLED" && !reason?.trim()) {
    throw invalidState("Disabling an employee needs a reason.", "REASON_REQUIRED");
  }

  const operations: any[] = [
    prisma.internalUser.update({
      where: { id: employeeId },
      data: {
        status,
        ...(status === "ACTIVE" ? { failedLoginCount: 0, lockedUntil: null } : {}),
      },
    }),
  ];

  // Disabling has to cut live sessions, not just block the next sign-in —
  // otherwise a revoked employee keeps working until their token expires.
  if (status === "DISABLED") {
    operations.push(
      prisma.internalSession.updateMany({
        where: { userId: employeeId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "EMPLOYEE_DISABLED" },
      }),
    );
  }

  operations.push(
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: status === "DISABLED" ? AUDIT_ACTIONS.EMPLOYEE_DISABLED : AUDIT_ACTIONS.EMPLOYEE_ENABLED,
        resourceType: "InternalUser",
        resourceId: employeeId,
        resourceLabel: employee.email,
        previousValue: { status: employee.status },
        newValue: { status },
        reason: reason ?? null,
      }),
    }),
  );

  await prisma.$transaction(operations);
  return getEmployee(employeeId);
};

export const resetEmployeeAccess = async (req: any, employeeId: number, reason: string) => {
  const employee = await prisma.internalUser.findUnique({ where: { id: employeeId } });
  if (!employee) throw notFound("Employee not found", "EMPLOYEE_NOT_FOUND");
  if (!reason?.trim()) throw invalidState("Resetting someone's access needs a reason.", "REASON_REQUIRED");

  const temporaryPassword = `${crypto.randomBytes(9).toString("base64url")}Aa1!`;

  await prisma.$transaction([
    prisma.internalUser.update({
      where: { id: employeeId },
      data: {
        password: await bcrypt.hash(temporaryPassword, 10),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.internalSession.updateMany({
      where: { userId: employeeId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "ACCESS_RESET" },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.EMPLOYEE_UPDATED,
        resourceType: "InternalUser",
        resourceId: employeeId,
        resourceLabel: employee.email,
        newValue: { accessReset: true },
        reason: reason.trim(),
      }),
    }),
  ]);

  return { temporaryPassword };
};

export const getEmployeeAuditHistory = (employeeId: number) =>
  listAuditForResource("InternalUser", employeeId, 100);

/** Actions this employee performed, as opposed to actions performed on them. */
export const getEmployeeActivity = (employeeId: number, limit = 100) =>
  prisma.internalAuditLog.findMany({
    where: { actorId: employeeId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

export const getDepartments = async () => {
  const rows = await prisma.internalUser.findMany({
    where: { department: { not: null } },
    distinct: ["department"],
    select: { department: true },
    orderBy: { department: "asc" },
  });
  return rows.map((r) => r.department).filter(Boolean);
};

/** Assignable employees for the ticket assignment dropdown. */
export const listAssignableEmployees = () =>
  prisma.internalUser.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, department: true },
  });
