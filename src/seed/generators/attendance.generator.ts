import type { Attendance, AttendanceBreak, Branch, Prisma, User } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import {
  addMinutes,
  batchCreateManyAndReturn,
  chance,
  type Db,
  historyDaysRange,
  randomFloat,
  randomInt,
  randomTimeOnDay,
  toUtcMidnight,
  weightedPick,
} from "../utils";

export interface AttendanceSeedResult {
  attendances: Attendance[];
  breaks: AttendanceBreak[];
}

interface BreakPlan {
  offsetMinutes: number;
  durationMinutes: number;
  reason: string;
}

function shiftWindow(branch: Branch, shift: string | null): { startHour: number; hours: number } {
  const openHour = branch.openingTime ? parseInt(branch.openingTime.split(":")[0], 10) : 10;
  const closeHour = branch.closingTime ? parseInt(branch.closingTime.split(":")[0], 10) : 23;
  const morningHours = branch.morningShiftHours ?? 6;
  const eveningHours = branch.eveningShiftHours ?? 6;
  const fullDayHours = branch.fullDayShiftHours ?? 10;

  if (shift === "EVENING") {
    const hours = eveningHours;
    return { startHour: Math.max(openHour, closeHour - hours - 1), hours };
  }
  if (shift === "FULL_DAY") {
    return { startHour: openHour, hours: fullDayHours };
  }
  return { startHour: openHour, hours: morningHours }; // MORNING, or unset
}

/**
 * Owns: Attendance and AttendanceBreak — one Attendance row per staff member
 * per calendar day over config.attendance.daysOfHistory, status drawn from
 * config.attendance.statusMix, with occasional overtime and lunch breaks.
 * Skips days before a staff member's joiningDate (they weren't hired yet)
 * and never generates attendance for the OWNER (not an operational shift
 * worker in this schema).
 *
 * Idempotent: generates once per restaurant, checked via a plain count().
 */
export async function generateAttendance(db: Db, config: SeedConfig, ctx: SeedContext): Promise<AttendanceSeedResult> {
  const existingCount = await db.attendance.count({ where: { restaurantId: ctx.restaurant.id } });
  if (existingCount > 0) {
    const [attendances, breaks] = await Promise.all([
      db.attendance.findMany({ where: { restaurantId: ctx.restaurant.id } }),
      db.attendanceBreak.findMany({ where: { attendance: { restaurantId: ctx.restaurant.id } } }),
    ]);
    return { attendances, breaks };
  }

  const days = historyDaysRange(config.attendance.daysOfHistory);
  const attendanceRows: Prisma.AttendanceCreateManyInput[] = [];
  const breakPlans: (BreakPlan | null)[] = [];

  const addRow = (user: User, branch: Branch, day: Date) => {
    if (toUtcMidnight(day).getTime() < toUtcMidnight(user.joiningDate ?? day).getTime()) return;

    const status = weightedPick(config.attendance.statusMix);
    const { startHour, hours } = shiftWindow(branch, user.shift);

    if (status === "ABSENT" || status === "LEAVE") {
      attendanceRows.push({
        userId: user.id,
        restaurantId: ctx.restaurant.id,
        branchId: branch.id,
        date: toUtcMidnight(day),
        status,
        totalHours: 0,
      });
      breakPlans.push(null);
      return;
    }

    const loginTime = randomTimeOnDay(day, startHour, startHour + 1);
    const isHalfDay = status === "HALF_DAY";
    let workedHours = (isHalfDay ? hours / 2 : hours) + randomFloat(-0.25, 0.25, 2);
    let overtimeHours = 0;
    if (!isHalfDay && chance(config.attendance.overtimeProbability)) {
      overtimeHours = randomFloat(0.5, 3, 2);
      workedHours += overtimeHours;
    }
    const logoutTime = addMinutes(loginTime, Math.round(workedHours * 60));

    attendanceRows.push({
      userId: user.id,
      restaurantId: ctx.restaurant.id,
      branchId: branch.id,
      date: toUtcMidnight(day),
      loginTime,
      logoutTime,
      totalHours: Math.round(workedHours * 100) / 100,
      overtimeHours,
      status,
    });

    const wantsBreak = !isHalfDay && chance(config.attendance.breakProbability);
    breakPlans.push(
      wantsBreak
        ? {
            offsetMinutes: Math.round((workedHours * 60) / 2) + randomInt(-20, 20),
            durationMinutes: randomInt(20, 45),
            reason: chance(0.8) ? "Lunch break" : "Tea break",
          }
        : null,
    );
  };

  for (const branchCtx of ctx.branches) {
    for (const user of branchCtx.staff) {
      for (const day of days) {
        addRow(user, branchCtx.branch, day);
      }
    }
  }

  const attendances = await batchCreateManyAndReturn(attendanceRows, (chunk) => db.attendance.createManyAndReturn({ data: chunk }));

  const breakRows: Prisma.AttendanceBreakCreateManyInput[] = [];
  attendances.forEach((attendance, i) => {
    const plan = breakPlans[i];
    if (!plan || !attendance.loginTime) return;
    const startTime = addMinutes(attendance.loginTime, plan.offsetMinutes);
    breakRows.push({
      attendanceId: attendance.id,
      startTime,
      endTime: addMinutes(startTime, plan.durationMinutes),
      totalMinutes: plan.durationMinutes,
      reason: plan.reason,
    });
  });
  const breaks = await batchCreateManyAndReturn(breakRows, (chunk) => db.attendanceBreak.createManyAndReturn({ data: chunk }));

  return { attendances, breaks };
}
