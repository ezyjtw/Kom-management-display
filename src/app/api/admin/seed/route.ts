import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { EmployeeRole, TeamName, Region, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * POST /api/admin/seed
 * Manually trigger employee + user seeding. Admin only.
 * Idempotent — uses upserts so safe to re-run.
 */
export async function POST() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

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
