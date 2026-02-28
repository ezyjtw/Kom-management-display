import { cookies } from "next/headers";

export type UserRole = "admin" | "lead" | "employee";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  employeeId: string | null;
}

/**
 * Get current session user from cookie.
 * In production, replace with proper JWT/session validation.
 * For MVP, we use a simple cookie-based approach.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");
  if (!sessionCookie) return null;

  try {
    return JSON.parse(sessionCookie.value) as SessionUser;
  } catch {
    return null;
  }
}

/**
 * Check if user can access an employee's data.
 */
export function canAccessEmployee(
  user: SessionUser,
  targetEmployeeId: string
): boolean {
  if (user.role === "admin") return true;
  if (user.role === "lead") return true; // leads can see their team — further scoping in queries
  return user.employeeId === targetEmployeeId;
}

/**
 * Check if user can modify scoring config.
 */
export function canModifyConfig(user: SessionUser): boolean {
  return user.role === "admin";
}

/**
 * Check if user can enter manual scores.
 */
export function canEnterManualScores(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "lead";
}
