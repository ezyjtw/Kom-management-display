import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { prisma } from "@/lib/prisma";
import { EmployeeRole, TeamName, Region, UserRole, TimePeriodType, ScoreCategory } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * POST /api/admin/seed
 * Manually trigger employee + user seeding. Admin only.
 * Idempotent — uses upserts so safe to re-run.
 */
export async function POST() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "user", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const results: string[] = [];

    // ── Ensure PostgreSQL enum types exist (safety net for databases missing migration 0014) ──
    const enumDefs: [string, string[]][] = [
      ["UserRole", ["admin", "lead", "employee", "auditor"]],
      ["EmployeeRole", ["Analyst", "Senior", "Lead", "Manager"]],
      ["TeamName", ["TransactionOperations", "AdminOperations", "DataOperations", "StakingOps", "Settlements"]],
      ["Region", ["Global", "EMEA", "APAC", "Americas"]],
    ];
    for (const [name, values] of enumDefs) {
      const valueList = values.map((v) => `'${v}'`).join(", ");
      await prisma.$executeRawUnsafe(
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${name}') THEN CREATE TYPE "${name}" AS ENUM (${valueList}); END IF; END $$;`
      );
    }

    // Convert TEXT columns to enum types if they're still TEXT
    const textToEnum: [string, string, string][] = [
      ["User", "role", "UserRole"],
      ["Employee", "role", "EmployeeRole"],
      ["Employee", "team", "TeamName"],
      ["Employee", "region", "Region"],
    ];
    for (const [table, column, enumName] of textToEnum) {
      await prisma.$executeRawUnsafe(
        `DO $$ BEGIN ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE "${enumName}" USING "${column}"::"${enumName}"; EXCEPTION WHEN others THEN NULL; END $$;`
      );
    }

    // ── Employees ──
    const employeeData: { name: string; email: string; role: EmployeeRole; team: TeamName; region: Region }[] = [
      { name: "Alice Chen", email: "alice@ops.com", role: EmployeeRole.Senior, team: TeamName.TransactionOperations, region: Region.APAC },
      { name: "Carol Davies", email: "carol@ops.com", role: EmployeeRole.Lead, team: TeamName.TransactionOperations, region: Region.EMEA },
      { name: "Grace Thompson", email: "grace@ops.com", role: EmployeeRole.Senior, team: TeamName.TransactionOperations, region: Region.EMEA },
      { name: "Kenji Yamamoto", email: "kenji@ops.com", role: EmployeeRole.Senior, team: TeamName.TransactionOperations, region: Region.APAC },
      { name: "Liam O'Brien", email: "liam@ops.com", role: EmployeeRole.Analyst, team: TeamName.TransactionOperations, region: Region.EMEA },
      { name: "Maria Santos", email: "maria@ops.com", role: EmployeeRole.Analyst, team: TeamName.TransactionOperations, region: Region.EMEA },
      { name: "Nikhil Patel", email: "nikhil@ops.com", role: EmployeeRole.Analyst, team: TeamName.TransactionOperations, region: Region.EMEA },
      { name: "Sophie Laurent", email: "sophie@ops.com", role: EmployeeRole.Analyst, team: TeamName.TransactionOperations, region: Region.EMEA },
      { name: "Tom Nakamura", email: "tom@ops.com", role: EmployeeRole.Analyst, team: TeamName.TransactionOperations, region: Region.APAC },
      { name: "Yuki Tanaka", email: "yuki@ops.com", role: EmployeeRole.Analyst, team: TeamName.TransactionOperations, region: Region.APAC },
      { name: "Bob Martinez", email: "bob@ops.com", role: EmployeeRole.Analyst, team: TeamName.AdminOperations, region: Region.Americas },
      { name: "Eva Kowalski", email: "eva@ops.com", role: EmployeeRole.Senior, team: TeamName.AdminOperations, region: Region.EMEA },
      { name: "David Park", email: "david@ops.com", role: EmployeeRole.Analyst, team: TeamName.DataOperations, region: Region.APAC },
      { name: "Frank Osei", email: "frank@ops.com", role: EmployeeRole.Analyst, team: TeamName.DataOperations, region: Region.EMEA },
    ];

    let employees: Awaited<ReturnType<typeof prisma.employee.upsert>>[] = [];
    try {
      employees = await prisma.$transaction(
        employeeData.map((data) =>
          prisma.employee.upsert({
            where: { email: data.email },
            update: { team: data.team, role: data.role, region: data.region, name: data.name, active: true },
            create: data,
          })
        )
      );
    } catch (txError) {
      // Fallback: try one at a time to identify failures
      for (const data of employeeData) {
        try {
          const emp = await prisma.employee.upsert({
            where: { email: data.email },
            update: { team: data.team, role: data.role, region: data.region, name: data.name, active: true },
            create: data,
          });
          employees.push(emp);
        } catch (e) {
          results.push(`Failed: ${data.email} — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    results.push(`Upserted ${employees.length} employees`);

    // ── Users ──
    const emp = Object.fromEntries(employees.map((e) => [e.email, e]));
    const SEED_ADMIN_PW = process.env.SEED_ADMIN_PASSWORD || "admin123";
    const SEED_USER_PW = process.env.SEED_USER_PASSWORD || "user123";
    const SEED_LEAD_PW = process.env.SEED_LEAD_PASSWORD || "lead123";
    const adminHash = await bcrypt.hash(SEED_ADMIN_PW, 10);
    const userHash = await bcrypt.hash(SEED_USER_PW, 10);
    const leadHash = await bcrypt.hash(SEED_LEAD_PW, 10);

    const userData = [
      { email: "manager@ops.com", name: "Ops Manager", role: UserRole.admin, password: adminHash, employeeId: null as string | null },
      { email: "carol@ops.com", name: "Carol Davies", role: UserRole.lead, password: leadHash, employeeId: emp["carol@ops.com"]?.id ?? null },
      { email: "alice@ops.com", name: "Alice Chen", role: UserRole.employee, password: userHash, employeeId: emp["alice@ops.com"]?.id ?? null },
      { email: "bob@ops.com", name: "Bob Martinez", role: UserRole.employee, password: userHash, employeeId: emp["bob@ops.com"]?.id ?? null },
      { email: "david@ops.com", name: "David Park", role: UserRole.employee, password: userHash, employeeId: emp["david@ops.com"]?.id ?? null },
      { email: "eva@ops.com", name: "Eva Kowalski", role: UserRole.employee, password: userHash, employeeId: emp["eva@ops.com"]?.id ?? null },
      { email: "frank@ops.com", name: "Frank Osei", role: UserRole.employee, password: userHash, employeeId: emp["frank@ops.com"]?.id ?? null },
      { email: "grace@ops.com", name: "Grace Thompson", role: UserRole.employee, password: userHash, employeeId: emp["grace@ops.com"]?.id ?? null },
      { email: "kenji@ops.com", name: "Kenji Yamamoto", role: UserRole.employee, password: userHash, employeeId: emp["kenji@ops.com"]?.id ?? null },
      { email: "liam@ops.com", name: "Liam O'Brien", role: UserRole.employee, password: userHash, employeeId: emp["liam@ops.com"]?.id ?? null },
      { email: "maria@ops.com", name: "Maria Santos", role: UserRole.employee, password: userHash, employeeId: emp["maria@ops.com"]?.id ?? null },
      { email: "nikhil@ops.com", name: "Nikhil Patel", role: UserRole.employee, password: userHash, employeeId: emp["nikhil@ops.com"]?.id ?? null },
      { email: "sophie@ops.com", name: "Sophie Laurent", role: UserRole.employee, password: userHash, employeeId: emp["sophie@ops.com"]?.id ?? null },
      { email: "tom@ops.com", name: "Tom Nakamura", role: UserRole.employee, password: userHash, employeeId: emp["tom@ops.com"]?.id ?? null },
      { email: "yuki@ops.com", name: "Yuki Tanaka", role: UserRole.employee, password: userHash, employeeId: emp["yuki@ops.com"]?.id ?? null },
    ];

    await prisma.$transaction(
      userData.map((data) =>
        prisma.user.upsert({
          where: { email: data.email },
          update: { employeeId: data.employeeId, name: data.name, role: data.role },
          create: data,
        })
      )
    );
    results.push(`Upserted ${userData.length} user accounts`);

    // ── Time Periods ──
    const periodData = [
      { type: TimePeriodType.month, startDate: new Date("2026-01-01"), endDate: new Date("2026-01-31"), label: "2026-01" },
      { type: TimePeriodType.month, startDate: new Date("2026-02-01"), endDate: new Date("2026-02-28"), label: "2026-02" },
      { type: TimePeriodType.week, startDate: new Date("2026-02-16"), endDate: new Date("2026-02-22"), label: "2026-W08" },
      { type: TimePeriodType.week, startDate: new Date("2026-02-23"), endDate: new Date("2026-03-01"), label: "2026-W09" },
      { type: TimePeriodType.quarter, startDate: new Date("2025-10-01"), endDate: new Date("2025-12-31"), label: "2025-Q4" },
      { type: TimePeriodType.quarter, startDate: new Date("2026-01-01"), endDate: new Date("2026-03-31"), label: "2026-Q1" },
    ];

    const periods = await Promise.all(
      periodData.map((data) =>
        prisma.timePeriod.upsert({
          where: { type_startDate: { type: data.type, startDate: data.startDate } },
          update: {},
          create: data,
        })
      )
    );
    results.push(`Upserted ${periods.length} time periods`);

    // ── Category Scores ──
    const categories: ScoreCategory[] = [ScoreCategory.daily_tasks, ScoreCategory.projects, ScoreCategory.asset_actions, ScoreCategory.quality, ScoreCategory.knowledge];
    const configVersion = "1.0.0";

    const scoreDataByEmail: Record<string, Record<string, [number, number]>> = {
      "alice@ops.com": { daily_tasks: [0.75, 0.82], projects: [0.65, 0.70], asset_actions: [0.80, 0.85], quality: [0.85, 0.80], knowledge: [0.70, 0.75] },
      "bob@ops.com": { daily_tasks: [0.55, 0.65], projects: [0.30, 0.45], asset_actions: [0.60, 0.70], quality: [0.70, 0.75], knowledge: [0.40, 0.50] },
      "carol@ops.com": { daily_tasks: [0.80, 0.78], projects: [0.90, 0.88], asset_actions: [0.70, 0.72], quality: [0.90, 0.92], knowledge: [0.85, 0.88] },
      "david@ops.com": { daily_tasks: [0.60, 0.55], projects: [0.20, 0.15], asset_actions: [0.65, 0.60], quality: [0.50, 0.35], knowledge: [0.35, 0.40] },
      "eva@ops.com": { daily_tasks: [0.70, 0.72], projects: [0.80, 0.85], asset_actions: [0.75, 0.78], quality: [0.80, 0.82], knowledge: [0.65, 0.70] },
      "frank@ops.com": { daily_tasks: [0.40, 0.52], projects: [0.25, 0.35], asset_actions: [0.45, 0.55], quality: [0.60, 0.65], knowledge: [0.30, 0.38] },
      "grace@ops.com": { daily_tasks: [0.78, 0.80], projects: [0.72, 0.75], asset_actions: [0.82, 0.84], quality: [0.88, 0.86], knowledge: [0.68, 0.72] },
      "kenji@ops.com": { daily_tasks: [0.72, 0.76], projects: [0.68, 0.72], asset_actions: [0.78, 0.82], quality: [0.82, 0.84], knowledge: [0.74, 0.78] },
      "liam@ops.com": { daily_tasks: [0.58, 0.62], projects: [0.35, 0.42], asset_actions: [0.55, 0.60], quality: [0.65, 0.68], knowledge: [0.42, 0.48] },
      "maria@ops.com": { daily_tasks: [0.62, 0.66], projects: [0.45, 0.50], asset_actions: [0.58, 0.62], quality: [0.72, 0.74], knowledge: [0.48, 0.52] },
      "nikhil@ops.com": { daily_tasks: [0.50, 0.56], projects: [0.38, 0.44], asset_actions: [0.52, 0.58], quality: [0.68, 0.70], knowledge: [0.45, 0.50] },
      "sophie@ops.com": { daily_tasks: [0.64, 0.68], projects: [0.48, 0.54], asset_actions: [0.62, 0.66], quality: [0.74, 0.76], knowledge: [0.52, 0.56] },
      "tom@ops.com": { daily_tasks: [0.56, 0.60], projects: [0.32, 0.40], asset_actions: [0.50, 0.56], quality: [0.66, 0.70], knowledge: [0.38, 0.44] },
      "yuki@ops.com": { daily_tasks: [0.60, 0.64], projects: [0.42, 0.48], asset_actions: [0.56, 0.62], quality: [0.70, 0.72], knowledge: [0.46, 0.52] },
    };

    let scoreCount = 0;
    for (const e of employees) {
      const empScores = scoreDataByEmail[e.email];
      if (!empScores) continue;

      for (const cat of categories) {
        const [janRaw, febRaw] = empScores[cat] ?? [0.5, 0.5];

        // January score (periods[0])
        await prisma.categoryScore.upsert({
          where: { employeeId_periodId_category: { employeeId: e.id, periodId: periods[0].id, category: cat } },
          update: { rawIndex: janRaw, score: 3 + janRaw * 5 },
          create: {
            employeeId: e.id, periodId: periods[0].id, category: cat,
            rawIndex: janRaw, score: 3 + janRaw * 5, configVersion,
            evidence: JSON.stringify([{ type: "seed", label: `${cat} Jan`, details: "Seed data" }]),
            metadata: JSON.stringify({ period: "January 2026", auto_generated: true }),
          },
        });

        // February score (periods[1])
        await prisma.categoryScore.upsert({
          where: { employeeId_periodId_category: { employeeId: e.id, periodId: periods[1].id, category: cat } },
          update: { rawIndex: febRaw, score: 3 + febRaw * 5 },
          create: {
            employeeId: e.id, periodId: periods[1].id, category: cat,
            rawIndex: febRaw, score: 3 + febRaw * 5, configVersion,
            evidence: JSON.stringify([{ type: "seed", label: `${cat} Feb`, details: "Seed data" }]),
            metadata: JSON.stringify({ period: "February 2026", auto_generated: true }),
          },
        });

        scoreCount += 2;
      }
    }
    results.push(`Upserted ${scoreCount} category scores`);

    return NextResponse.json({ success: true, data: { results } });
  } catch (error) {
    console.error("[POST /api/admin/seed] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: `Seed failed: ${message}` },
      { status: 500 }
    );
  }
}
