import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`;

    // Count users
    const userCount = await prisma.user.count();

    // List all user emails (no passwords)
    const users = await prisma.user.findMany({
      select: { email: true, role: true, name: true, employeeId: true },
    });

    // Count employees
    const employeeCount = await prisma.employee.count();

    // Check environment
    const env = {
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "NOT SET",
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? "SET (hidden)" : "NOT SET",
      DATABASE_URL: process.env.DATABASE_URL ? "SET (hidden)" : "NOT SET",
      RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN ?? "NOT SET",
      NODE_ENV: process.env.NODE_ENV ?? "NOT SET",
    };

    return NextResponse.json({
      status: "ok",
      database: "connected",
      userCount,
      users,
      employeeCount,
      env,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: "error",
        message: error.message,
        code: error.code,
      },
      { status: 500 }
    );
  }
}
