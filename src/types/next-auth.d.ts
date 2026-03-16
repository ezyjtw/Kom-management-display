/* eslint-disable @typescript-eslint/no-unused-vars */
import NextAuth, { DefaultSession, DefaultUser } from "next-auth";
import { JWT, DefaultJWT } from "next-auth/jwt";

/**
 * Augment NextAuth types to include custom session/token fields.
 * This eliminates all `as any` casts in auth-options.ts and auth-user.ts.
 */
declare module "next-auth" {
  interface User extends DefaultUser {
    role?: string;
    employeeId?: string | null;
    team?: string | null;
  }

  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: string;
      employeeId?: string | null;
      team?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    role?: string;
    employeeId?: string | null;
    team?: string | null;
  }
}
