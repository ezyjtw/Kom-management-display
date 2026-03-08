import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { checkLoginRateLimit, resetLoginRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

async function logLoginAudit(userId: string, email: string, success: boolean) {
  try {
    // Find the employee record linked to this user for the audit userId field
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { employeeId: true },
    });
    const actorId = user?.employeeId || userId;

    await prisma.auditLog.create({
      data: {
        action: success ? "login_success" : "login_failed",
        entityType: "session",
        entityId: userId,
        userId: actorId,
        details: JSON.stringify({ email, success }),
      },
    });
  } catch {
    // Audit logging should never break the login flow
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          logger.warn("Login attempt with missing credentials");
          return null;
        }

        // Rate limiting: prevent brute-force attacks
        const rateCheck = checkLoginRateLimit(credentials.email);
        if (!rateCheck.allowed) {
          logger.security("Login rate limited", {
            email: credentials.email,
            retryAfterMs: rateCheck.retryAfterMs,
          });
          throw new Error("Too many login attempts. Please try again later.");
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) {
          logger.info("Login attempt for unknown email", { email: credentials.email });
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) {
          logger.security("Failed login attempt", { email: credentials.email, remainingAttempts: rateCheck.remainingAttempts });
          await logLoginAudit(user.id, credentials.email, false);
          return null;
        }

        // Successful login — reset rate limit counter
        resetLoginRateLimit(credentials.email);
        logger.info("Login successful", { email: credentials.email, role: user.role });
        await logLoginAudit(user.id, credentials.email, true);

        // Look up employee team for role-based queue scoping
        let team: string | null = null;
        if (user.employeeId) {
          const employee = await prisma.employee.findUnique({
            where: { id: user.employeeId },
            select: { team: true },
          });
          team = employee?.team ?? null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          employeeId: user.employeeId,
          team,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.employeeId = (user as any).employeeId;
        token.team = (user as any).team;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub;
        (session.user as any).role = token.role;
        (session.user as any).employeeId = token.employeeId;
        (session.user as any).team = token.team;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  secret: process.env.NEXTAUTH_SECRET,
};
