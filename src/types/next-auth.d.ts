import { DefaultSession } from "next-auth";

/**
 * Augment NextAuth types to include custom session/token fields.
 * This eliminates all `as any` casts in auth-options.ts and auth-user.ts.
 */
declare module "next-auth" {
  interface User {
    role?: string;
    employeeId?: string | null;
    team?: string | null;
  }

  interface Session {
    user: DefaultSession["user"] & {
      id?: string;
      role?: string;
      employeeId?: string | null;
      team?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    employeeId?: string | null;
    team?: string | null;
  }
}
