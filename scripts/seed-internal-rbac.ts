/**
 * Bootstraps the DineInk internal console: system roles, default platform
 * settings, feature flags, and optionally the first Super Admin.
 *
 * Deliberately NOT part of `prisma/seed.ts` — that seeder generates demo
 * restaurant data and is destructive with `--fresh`. This one is idempotent,
 * additive, and safe to run against a real environment, because the roles it
 * creates have to exist there.
 *
 *   npm run seed:internal
 *   npm run seed:internal -- --sync-permissions
 *   INTERNAL_BOOTSTRAP_EMAIL=ops@dineink.com INTERNAL_BOOTSTRAP_NAME="Ops Lead" npm run seed:internal
 *
 * By default an existing role's permissions are left alone: once an
 * administrator has tuned a role through the UI, re-running the bootstrap must
 * not quietly reset their work. `--sync-permissions` opts into overwriting them
 * from the templates in modules/internal/rbac/permissions.ts.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "../generated/prisma";
import prisma from "../src/config/prisma";
import { ROLE_TEMPLATES } from "../src/modules/internal/rbac/permissions";
import { nextEmployeeCode } from "../src/modules/internal/shared/ids";
import { normalizeEmail } from "../src/utils/email";

const syncPermissions = process.argv.includes("--sync-permissions");

/**
 * The only settings the console genuinely reads.
 *
 * Removed with the business-model correction: payments.commissionPercent and
 * payments.settlementCycleDays (DineInk takes no share of restaurant sales),
 * business.inactiveRestaurantDays and business.atRiskRestaurantDays (a cafe
 * that has taken no orders is not a customer at risk — we sell them software,
 * we do not run their kitchen), and the two security keys that nothing ever
 * consulted.
 */
const DEFAULT_SETTINGS: { key: string; group: string; value: unknown; description: string }[] = [
  { key: "company.name", group: "company", value: "DineInk", description: "Legal company name shown across the internal console" },
  { key: "company.supportEmail", group: "company", value: null, description: "Support address shown to customers" },
  { key: "company.supportPhone", group: "company", value: null, description: "Support phone number shown to customers" },
];

// Feature flags are deliberately not seeded. They were reference-project
// functionality, Dineink has not asked for them, and three rows advertising a
// module that does not exist is worse than none.

const seedRoles = async () => {
  for (const template of ROLE_TEMPLATES) {
    const existing = await prisma.internalRole.findUnique({ where: { key: template.key } });

    if (!existing) {
      await prisma.internalRole.create({
        data: {
          key: template.key,
          name: template.name,
          description: template.description,
          isSystem: true,
          accountScope: template.scope,
          permissions: { create: template.permissions.map((permission) => ({ permission })) },
        },
      });
      console.log(`  + created role ${template.key} (${template.permissions.length} permissions)`);
      continue;
    }

    if (!syncPermissions) {
      console.log(`  = role ${template.key} already exists — permissions left as configured`);
      continue;
    }

    await prisma.$transaction([
      prisma.internalRolePermission.deleteMany({ where: { roleId: existing.id } }),
      prisma.internalRolePermission.createMany({
        data: template.permissions.map((permission) => ({ roleId: existing.id, permission })),
      }),
      prisma.internalRole.update({
        where: { id: existing.id },
        data: {
          name: template.name,
          description: template.description,
          isSystem: true,
          accountScope: template.scope,
        },
      }),
    ]);
    console.log(`  ~ synced role ${template.key} to template (${template.permissions.length} permissions)`);
  }
};

const seedSettings = async () => {
  for (const setting of DEFAULT_SETTINGS) {
    const existing = await prisma.platformSetting.findUnique({ where: { key: setting.key } });
    if (existing) continue;
    await prisma.platformSetting.create({
      data: {
        key: setting.key,
        group: setting.group,
        // Prisma distinguishes a stored JSON null from "no value", and `value`
        // is a non-nullable column — Prisma.JsonNull is what writes an actual
        // JSON null, which is how a deliberately-unset setting is represented.
        value: setting.value === null ? Prisma.JsonNull : (setting.value as any),
        description: setting.description,
      },
    });
    console.log(`  + setting ${setting.key}`);
  }
};

const seedBootstrapAdmin = async () => {
  const rawEmail = process.env.INTERNAL_BOOTSTRAP_EMAIL;
  if (!rawEmail) {
    const anyUser = await prisma.internalUser.count();
    if (anyUser === 0) {
      console.log(
        "\n  ! No internal employees exist and INTERNAL_BOOTSTRAP_EMAIL is not set.\n" +
          "    Re-run with INTERNAL_BOOTSTRAP_EMAIL=you@yourcompany.com to create the first Super Admin.",
      );
    }
    return;
  }

  const email = normalizeEmail(rawEmail);
  const existing = await prisma.internalUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`  = employee ${email} already exists — left untouched`);
    return;
  }

  const superAdmin = await prisma.internalRole.findUnique({ where: { key: "SUPER_ADMIN" } });
  if (!superAdmin) throw new Error("SUPER_ADMIN role missing — role seeding failed");

  // Generated here and printed once rather than read from an environment
  // variable, so the first password never ends up in a shell history or a CI
  // log. mustChangePassword forces it to be replaced at first sign-in.
  const password = `${crypto.randomBytes(9).toString("base64url")}Aa1!`;
  const employeeCode = await nextEmployeeCode(prisma);

  await prisma.internalUser.create({
    data: {
      employeeCode,
      name: process.env.INTERNAL_BOOTSTRAP_NAME || "Super Admin",
      email,
      password: await bcrypt.hash(password, 10),
      department: "Administration",
      designation: "Super Admin",
      status: "ACTIVE",
      mustChangePassword: true,
      roles: { create: [{ roleId: superAdmin.id }] },
    },
  });

  console.log("\n  ┌──────────────────────────────────────────────────────────");
  console.log(`  │ Super Admin created: ${email} (${employeeCode})`);
  console.log(`  │ Temporary password:  ${password}`);
  console.log("  │ This is shown once. It must be changed at first sign-in.");
  console.log("  └──────────────────────────────────────────────────────────\n");
};

const main = async () => {
  console.log("Seeding DineInk internal console…\n");
  console.log("Roles:");
  await seedRoles();
  console.log("\nPlatform settings:");
  await seedSettings();
  console.log("\nBootstrap admin:");
  await seedBootstrapAdmin();
  console.log("\nDone.");
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
