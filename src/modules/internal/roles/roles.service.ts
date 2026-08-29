import prisma from "../../../config/prisma";
import { AUDIT_ACTIONS, auditData } from "../audit/audit.service";
import { ALL_PERMISSIONS, isPermission, PERMISSION_GROUPS } from "../rbac/permissions";
import { conflict, invalidState, notFound } from "../shared/apiError";

/**
 * Roles and permissions administration.
 *
 * Three rules are enforced here, all of them for the same reason — an
 * administration screen that can be used to grant yourself more than you have
 * is not an administration screen, it's a privilege-escalation route:
 *
 *   1. You cannot add a permission to a role that you don't hold yourself.
 *   2. You cannot edit a role you currently hold. (Otherwise rule 1 is
 *      irrelevant: you'd simply add permissions to your own role over several
 *      passes, each time holding what you granted last time.)
 *   3. System roles can be re-permissioned but never deleted, so an install
 *      can't be left with no way back in.
 */

export const listRoles = async () => {
  const roles = await prisma.internalRole.findMany({
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    include: {
      permissions: { select: { permission: true } },
      _count: { select: { users: true } },
    },
  });

  return roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.permissions.map((p) => p.permission).sort(),
    userCount: role._count.users,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  }));
};

export const getRole = async (roleId: number) => {
  const role = await prisma.internalRole.findUnique({
    where: { id: roleId },
    include: {
      permissions: { select: { permission: true } },
      users: {
        select: {
          createdAt: true,
          user: { select: { id: true, employeeCode: true, name: true, email: true, status: true } },
        },
      },
    },
  });
  if (!role) throw notFound("Role not found", "ROLE_NOT_FOUND");

  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.permissions.map((p) => p.permission).sort(),
    users: role.users.map((link) => ({ ...link.user, grantedAt: link.createdAt })),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
};

export const getPermissionCatalog = () => ({
  groups: PERMISSION_GROUPS,
  all: ALL_PERMISSIONS,
});

const actorContext = async (actorId: number) => {
  const rows = await prisma.internalUserRole.findMany({
    where: { userId: actorId },
    select: { roleId: true, role: { select: { permissions: { select: { permission: true } } } } },
  });
  return {
    roleIds: new Set(rows.map((r) => r.roleId)),
    permissions: new Set(rows.flatMap((r) => r.role.permissions.map((p) => p.permission))),
  };
};

const validatePermissions = (permissions: string[]) => {
  const unknown = permissions.filter((p) => !isPermission(p));
  if (unknown.length) {
    throw invalidState(
      `Unknown permission${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`,
      "UNKNOWN_PERMISSION",
    );
  }
};

export const createRole = async (
  req: any,
  input: { key?: string; name: string; description?: string; permissions: string[] },
) => {
  const name = input.name?.trim();
  if (!name) throw invalidState("Give the role a name.", "NAME_REQUIRED");

  const key = (input.key?.trim() || name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!key) throw invalidState("Give the role a name that contains letters or numbers.", "INVALID_KEY");

  const existing = await prisma.internalRole.findUnique({ where: { key } });
  if (existing) throw conflict(`A role with the key ${key} already exists.`, "ROLE_EXISTS");

  const permissions = [...new Set(input.permissions ?? [])];
  validatePermissions(permissions);

  const actor = await actorContext(req.internal.id);
  const excess = permissions.filter((p) => !actor.permissions.has(p));
  if (excess.length) {
    throw invalidState(
      `You can't grant permissions you don't have yourself: ${excess.slice(0, 3).join(", ")}${excess.length > 3 ? `, +${excess.length - 3} more` : ""}.`,
      "CANNOT_GRANT_EXCESS_PERMISSIONS",
    );
  }

  const role = await prisma.$transaction(async (tx) => {
    const created = await tx.internalRole.create({
      data: {
        key,
        name,
        description: input.description?.trim() || null,
        isSystem: false,
        permissions: { create: permissions.map((permission) => ({ permission })) },
      },
    });
    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ROLE_CREATED,
        resourceType: "InternalRole",
        resourceId: created.id,
        resourceLabel: created.name,
        newValue: { key, name, permissions },
      }),
    });
    return created;
  });

  return getRole(role.id);
};

export const updateRole = async (
  req: any,
  roleId: number,
  input: { name?: string; description?: string },
) => {
  const role = await prisma.internalRole.findUnique({ where: { id: roleId } });
  if (!role) throw notFound("Role not found", "ROLE_NOT_FOUND");

  const data: Record<string, any> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw invalidState("A role must have a name.", "NAME_REQUIRED");
    data.name = name;
  }
  if (input.description !== undefined) data.description = input.description.trim() || null;
  if (!Object.keys(data).length) throw invalidState("Nothing to update.", "NO_CHANGES");

  await prisma.$transaction([
    prisma.internalRole.update({ where: { id: roleId }, data }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ROLE_UPDATED,
        resourceType: "InternalRole",
        resourceId: roleId,
        resourceLabel: role.name,
        previousValue: { name: role.name, description: role.description },
        newValue: data,
      }),
    }),
  ]);

  return getRole(roleId);
};

export const setRolePermissions = async (req: any, roleId: number, permissions: string[]) => {
  const role = await prisma.internalRole.findUnique({
    where: { id: roleId },
    include: { permissions: { select: { permission: true } } },
  });
  if (!role) throw notFound("Role not found", "ROLE_NOT_FOUND");

  const next = [...new Set(permissions ?? [])];
  validatePermissions(next);

  const actor = await actorContext(req.internal.id);

  // Rule 2 — see the note at the top of this file.
  if (actor.roleIds.has(roleId)) {
    throw invalidState(
      `You hold the "${role.name}" role yourself, so you can't change its permissions. Ask another administrator.`,
      "CANNOT_EDIT_OWN_ROLE",
    );
  }

  const previous = role.permissions.map((p) => p.permission);
  const added = next.filter((p) => !previous.includes(p));
  const excess = added.filter((p) => !actor.permissions.has(p));
  if (excess.length) {
    throw invalidState(
      `You can't grant permissions you don't have yourself: ${excess.slice(0, 3).join(", ")}${excess.length > 3 ? `, +${excess.length - 3} more` : ""}.`,
      "CANNOT_GRANT_EXCESS_PERMISSIONS",
    );
  }

  const removed = previous.filter((p) => !next.includes(p));

  await prisma.$transaction([
    prisma.internalRolePermission.deleteMany({ where: { roleId, permission: { in: removed } } }),
    prisma.internalRolePermission.createMany({
      data: added.map((permission) => ({ roleId, permission })),
      skipDuplicates: true,
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ROLE_PERMISSIONS_CHANGED,
        resourceType: "InternalRole",
        resourceId: roleId,
        resourceLabel: role.name,
        previousValue: { permissions: previous.sort() },
        newValue: { permissions: next.sort(), added, removed },
      }),
    }),
  ]);

  return getRole(roleId);
};

export const deleteRole = async (req: any, roleId: number) => {
  const role = await prisma.internalRole.findUnique({
    where: { id: roleId },
    include: { _count: { select: { users: true } } },
  });
  if (!role) throw notFound("Role not found", "ROLE_NOT_FOUND");
  if (role.isSystem) {
    throw invalidState(
      `"${role.name}" is a built-in role and can't be deleted. Change its permissions instead.`,
      "SYSTEM_ROLE",
    );
  }
  if (role._count.users > 0) {
    throw invalidState(
      `${role._count.users} employee${role._count.users === 1 ? " is" : "s are"} still assigned this role. Move them off it first.`,
      "ROLE_IN_USE",
    );
  }

  await prisma.$transaction([
    prisma.internalRole.delete({ where: { id: roleId } }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ROLE_UPDATED,
        resourceType: "InternalRole",
        resourceId: roleId,
        resourceLabel: role.name,
        previousValue: { key: role.key, name: role.name },
        newValue: { deleted: true },
      }),
    }),
  ]);

  return true;
};
