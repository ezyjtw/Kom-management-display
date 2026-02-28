import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

/**
 * Get the authenticated user from the current request context.
 * Returns null if not authenticated.
 */
export async function getAuthUser() {
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
