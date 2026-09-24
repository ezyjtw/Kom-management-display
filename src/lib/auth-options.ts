import type { NextAuthOptions, Profile } from "next-auth";
import type { Provider } from "next-auth/providers/index";
import CredentialsProvider from "next-auth/providers/credentials";
import AzureADProvider from "next-auth/providers/azure-ad";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { checkLoginRateLimit, resetLoginRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { recordSession, revokeSession } from "@/lib/session-revocation";
import { env } from "@/lib/env";
import { SESSION_MAX_AGE_SECONDS, sessionCookieName } from "@/lib/session-config";
import {
  decideSsoLogin,
  emailFromClaims,
  isAzureAdConfigured,
  isLocalLoginAllowed,
  parseRoleGroupMap,
  type EntraProfileClaims,
} from "@/lib/sso";

/** Secure (HTTPS) deployments get Secure, __Host- cookies. */
const SECURE_COOKIES = (env("NEXTAUTH_URL") ?? "").startsWith("https://");

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

/** Marks SSO-only users; not a bcrypt hash, so it can never match a password. */
const SSO_ONLY_PASSWORD = "!sso-only";

const credentialsProvider = () =>
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
  });

export interface ProviderConfig {
  NODE_ENV?: string;
  ALLOW_LOCAL_LOGIN?: string;
  AZURE_AD_TENANT_ID?: string;
  AZURE_AD_CLIENT_ID?: string;
  AZURE_AD_CLIENT_SECRET?: string;
}

/**
 * Entra ID when configured; credentials only outside production with
 * ALLOW_LOCAL_LOGIN=true. Production never registers the credentials provider.
 */
export function buildProviders(cfg: ProviderConfig): Provider[] {
  const providers: Provider[] = [];
  if (isAzureAdConfigured(cfg)) {
    providers.push(
      AzureADProvider({
        clientId: cfg.AZURE_AD_CLIENT_ID!,
        clientSecret: cfg.AZURE_AD_CLIENT_SECRET!,
        tenantId: cfg.AZURE_AD_TENANT_ID!,
        authorization: { params: { scope: "openid profile email" } },
      }),
    );
  }
  if (isLocalLoginAllowed(cfg.NODE_ENV, cfg.ALLOW_LOCAL_LOGIN)) {
    providers.push(credentialsProvider());
  }
  return providers;
}

async function auditSsoDenied(email: string | null, reason: string) {
  logger.security("SSO login denied", { email, reason });
  try {
    await prisma.auditLog.create({
      data: {
        action: "sso_login_denied",
        entityType: "session",
        entityId: email ?? "unknown",
        userId: "system",
        details: JSON.stringify({ email, reason }),
      },
    });
  } catch {
    // Audit logging should never break the login flow
  }
}

/** Create or refresh the local User for an allowed SSO login. Groups are the source of truth for role. */
async function upsertSsoUser(email: string, name: string, role: "admin" | "lead" | "employee" | "auditor") {
  const employee = await prisma.employee.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, team: true },
  });
  const user = await prisma.user.upsert({
    where: { email },
    update: { role, name, employeeId: employee?.id ?? null },
    create: { email, name, role, password: SSO_ONLY_PASSWORD, employeeId: employee?.id ?? null },
  });
  return { user, team: employee?.team ?? null };
}

export const authOptions: NextAuthOptions = {
  providers: buildProviders({
    NODE_ENV: env("NODE_ENV"),
    ALLOW_LOCAL_LOGIN: env("ALLOW_LOCAL_LOGIN"),
    AZURE_AD_TENANT_ID: env("AZURE_AD_TENANT_ID"),
    AZURE_AD_CLIENT_ID: env("AZURE_AD_CLIENT_ID"),
    AZURE_AD_CLIENT_SECRET: env("AZURE_AD_CLIENT_SECRET"),
  }),
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "azure-ad") return true;

      const decision = await decideSsoLogin(
        (profile ?? {}) as EntraProfileClaims,
        parseRoleGroupMap(env("ROLE_GROUP_MAP")),
        async (email) =>
          (await prisma.employee.count({
            where: { email: { equals: email, mode: "insensitive" }, active: true },
          })) > 0,
      );
      if (!decision.allowed) {
        await auditSsoDenied(decision.email, decision.reason);
        return false;
      }

      try {
        const { user } = await upsertSsoUser(decision.email, profile?.name || decision.email, decision.role);
        await logLoginAudit(user.id, decision.email, true);
        return true;
      } catch (error) {
        logger.error("SSO user provisioning failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        await auditSsoDenied(decision.email, "provisioning_failed");
        return false;
      }
    },
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "azure-ad") {
        // Replace the IdP subject with our own User record.
        const email = emailFromClaims((profile ?? {}) as Profile & EntraProfileClaims);
        const dbUser = email ? await prisma.user.findUnique({ where: { email } }) : null;
        if (!dbUser) return token;
        const employee = dbUser.employeeId
          ? await prisma.employee.findUnique({ where: { id: dbUser.employeeId }, select: { team: true } })
          : null;
        token.sub = dbUser.id;
        token.email = dbUser.email;
        token.name = dbUser.name;
        token.role = dbUser.role;
        token.employeeId = dbUser.employeeId;
        token.team = employee?.team ?? null;
      } else if (user) {
        token.role = user.role;
        token.employeeId = user.employeeId;
        token.team = user.team;
      }

      if (account) {
        // Role, employee and team were set above from the provider-specific branch.
        // (Re-assigning them from `user` here wiped the database role for SSO users,
        // whose provider `user` object carries no role.)
        token.authTime = Math.floor(Date.now() / 1000);

        // Record session in metadata table for revocation tracking
        const jti = token.jti as string | undefined;
        const sub = token.sub as string | undefined;
        if (jti && sub) {
          recordSession({
            userId: sub,
            sessionToken: jti,
            expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
          }).catch(() => {
            // Session recording should never break login
          });
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? undefined;
        session.user.role = (token.role as string) ?? undefined;
        session.user.employeeId = (token.employeeId as string | null) ?? null;
        session.user.team = (token.team as string | null) ?? null;
        session.user.jti = (token.jti as string) ?? undefined;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  cookies: {
    sessionToken: {
      name: sessionCookieName(SECURE_COOKIES),
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: SECURE_COOKIES },
    },
  },
  events: {
    async signOut({ token }) {
      // Spec §17.7: sign-out is audit-logged; the session is revoked so the JWT cannot be reused.
      const jti = (token?.jti as string | undefined) ?? null;
      if (jti) await revokeSession(jti, "sign_out").catch(() => undefined);
      await prisma.auditLog.create({
        data: { action: "logout", entityType: "session", entityId: jti ?? "unknown", userId: (token?.employeeId as string | null) ?? "system", details: JSON.stringify({ summary: "Signed out", metadata: { actorUserId: token?.sub ?? null } }) },
      }).catch(() => undefined);
    },
  },
  secret: env("NEXTAUTH_SECRET"),
};
