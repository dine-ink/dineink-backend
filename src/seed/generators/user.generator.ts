import bcrypt from "bcryptjs";
import { subDays } from "date-fns";
import type { Prisma, User } from "../../../generated/prisma";
import type { SeedConfig, UsersPerBranchConfig } from "../config";
import { type Db, faker, randomInt, uniqueEmail, uniqueIndianMobile, weightedPick } from "../utils";

const BCRYPT_ROUNDS = 10;

const SALARY_RANGES: Record<keyof UsersPerBranchConfig, [number, number]> = {
  MANAGER: [35000, 55000],
  CASHIER: [16000, 22000],
  CHEF: [20000, 38000],
  WAITER: [13000, 18000],
  CLEANING: [11000, 15000],
};

const DEPARTMENTS: Record<keyof UsersPerBranchConfig, string> = {
  MANAGER: "MANAGEMENT",
  CASHIER: "FRONT_OF_HOUSE",
  CHEF: "KITCHEN",
  WAITER: "FRONT_OF_HOUSE",
  CLEANING: "HOUSEKEEPING",
};

const SHIFT_MIX = { MORNING: 0.4, EVENING: 0.4, FULL_DAY: 0.2 };
const EMPLOYMENT_TYPE_MIX = { FULL_TIME: 0.85, PART_TIME: 0.15 };

function monthlyWorkingHoursFor(employmentType: string): number {
  return employmentType === "FULL_TIME" ? randomInt(208, 260) : randomInt(100, 150);
}

/**
 * Owns: staff User rows (MANAGER/CASHIER/CHEF/WAITER/CLEANING) for a single
 * branch, per config.usersPerBranch. The restaurant-wide OWNER user is
 * created separately by restaurant.generator.ts since it must exist before
 * any Branch does. CLEANING staff get hasLogin=false — they're
 * attendance-tracked but don't touch the POS.
 *
 * Idempotent: staff has no natural unique key beyond email/phone (globally
 * unique, not per branch), so this generates the configured headcount once
 * per branch and leaves existing staff alone on subsequent plain runs —
 * re-rolling names/salaries every run would just mean duplicate emails
 * crashing on the second run. Use --fresh to regenerate staff from scratch.
 */
export async function generateBranchStaff(
  db: Db,
  config: SeedConfig,
  restaurantId: number,
  branchId: number,
): Promise<User[]> {
  const existing = await db.user.findMany({ where: { branchId } });
  if (existing.length > 0) return existing;

  const hashedPassword = await bcrypt.hash(config.staffPassword, BCRYPT_ROUNDS);

  const rows: Prisma.UserCreateManyInput[] = [];
  for (const role of Object.keys(config.usersPerBranch) as (keyof UsersPerBranchConfig)[]) {
    const count = config.usersPerBranch[role];
    const [minSalary, maxSalary] = SALARY_RANGES[role];

    for (let i = 0; i < count; i++) {
      const name = `${faker.person.firstName()} ${faker.person.lastName()}`;
      const employmentType = weightedPick(EMPLOYMENT_TYPE_MIX);

      rows.push({
        name,
        email: uniqueEmail(name),
        phone: uniqueIndianMobile(),
        password: hashedPassword,
        role,
        hasLogin: role !== "CLEANING",
        isActive: true,
        isDeleted: false,
        restaurantId,
        branchId,
        salary: randomInt(minSalary, maxSalary),
        joiningDate: subDays(new Date(), randomInt(30, 1000)),
        shift: weightedPick(SHIFT_MIX),
        employmentType,
        monthlyWorkingHours: monthlyWorkingHoursFor(employmentType),
        department: DEPARTMENTS[role],
      });
    }
  }

  return db.user.createManyAndReturn({ data: rows });
}
