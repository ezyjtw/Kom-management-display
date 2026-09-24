import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import bcrypt from "bcryptjs";
import { apiSuccess, apiValidationError, apiConflictError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, createUserSchema } from "@/lib/validation";
import { validatePassword, BCRYPT_ROUNDS } from "@/lib/password-policy";
import { auditedAction } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";

/**
 * GET /api/users
 * List all user accounts (without passwords). Admin only.
 */
export async function GET() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "user", "view");
  if (authz instanceof NextResponse) return authz;

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
    const parsed = validateBody(createUserSchema, body);
    if (!parsed.success) return apiValidationError(parsed.error);
    const { name, email, password, role, employeeId } = parsed.data;

    // Enforce password policy
    const pwResult = validatePassword(password, { email, name });
    if (!pwResult.valid) {
      return apiValidationError(pwResult.errors.join("; "));
    }

    // Check for existing user
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return apiConflictError("A user with this email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const actor = auditActor(auth);
    // The user id is not known until it is created: it is in the outcome.
    const user = await auditedAction(
      {
        action: "user_created",
        entityType: "user",
        entityId: "new",
        userId: actor.userId,
        summary: `Create user account (${role || "employee"})`,
        after: { email, role: role || "employee" },
        metadata: actor.metadata,
      },
      async () => prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: role ?? "employee",
          employeeId: employeeId ?? null,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          employeeId: true,
          createdAt: true,
        },
      }),
      (r) => ({ createdUserId: r.id }),
      { entityId: (r) => r.id },
    );

    return apiSuccess(user, undefined, 201);
  } catch (error) {
    return handleApiError(error, "users POST");
  }
}
