import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-user";
import bcrypt from "bcryptjs";
import { apiSuccess, apiValidationError, apiConflictError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

const MIN_PASSWORD_LENGTH = 8;

/**
 * GET /api/users
 * List all user accounts (without passwords). Admin only.
 */
export async function GET() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        employeeId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return apiSuccess(users);
  } catch (error) {
    return handleApiError(error, "users GET");
  }
}

/**
 * POST /api/users
 * Create a new user account. Admin only.
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.sensitive);
  if (limited) return limited;

  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { name, email, password, role, employeeId } = body;

    if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !email.includes("@") || typeof password !== "string") {
      return apiValidationError("name (string), email (valid email), and password (string) are required");
    }

    // Validate password strength
    if (password.length < MIN_PASSWORD_LENGTH) {
      return apiValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    // Validate role
    const validRoles = ["admin", "lead", "employee"];
    if (role && !validRoles.includes(role)) {
      return apiValidationError(`Invalid role. Must be one of: ${validRoles.join(", ")}`);
    }

    // Check for existing user
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return apiConflictError("A user with this email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role || "employee",
        employeeId: employeeId || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        employeeId: true,
        createdAt: true,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: "user_created",
        entityType: "user",
        entityId: user.id,
        userId: auth.id,
        details: JSON.stringify({ email, role: role || "employee" }),
      },
    });

    return apiSuccess(user, undefined, 201);
  } catch (error) {
    return handleApiError(error, "users POST");
  }
}
