import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  employeeId: string | null;
}

/**
 * Get the authenticated user from the current request context.
 * Returns null if not authenticated.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  return {
    id: (session.user as any).id as string,
    name: session.user.name || "Unknown",
    email: session.user.email || "",
    role: (session.user as any).role as string,
    employeeId: (session.user as any).employeeId as string | null,
  };
}

/**
 * Require the user to be authenticated. Returns 401 if not.
 */
export async function requireAuth(): Promise<AuthUser | NextResponse> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }
  return user;
}

/**
 * Require the user to have one of the specified roles.
 * Returns 403 if the user doesn't have permission.
 */
export async function requireRole(...roles: string[]): Promise<AuthUser | NextResponse> {
  const result = await requireAuth();
  if (result instanceof NextResponse) return result;

  if (!roles.includes(result.role)) {
    return NextResponse.json(
      { success: false, error: "Insufficient permissions" },
      { status: 403 }
    );
  }
  return result;
}

/**
 * Sanitize error for client response — never expose internals.
 */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Only return generic messages; strip Prisma/DB details
    if (error.message.includes("Unique constraint")) {
      return "A record with this value already exists";
    }
    if (error.message.includes("Record to update not found")) {
      return "Record not found";
    }
    if (error.message.includes("Foreign key constraint")) {
      return "Referenced record does not exist";
    }
  }
  return "An internal error occurred";
}
