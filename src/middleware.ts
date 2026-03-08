import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

/** Role-based idle timeout in seconds. Privileged roles get shorter timeouts. */
const IDLE_TIMEOUT_SECONDS: Record<string, number> = {
  admin: 2 * 60 * 60,    // 2 hours
  lead: 4 * 60 * 60,     // 4 hours
  employee: 8 * 60 * 60, // 8 hours
  auditor: 4 * 60 * 60,  // 4 hours
};

export async function middleware(req: NextRequest) {
  // Determine if the original request was over HTTPS (handles reverse proxies like Railway)
  const isSecure =
    process.env.NEXTAUTH_URL?.startsWith("https://") ||
    req.headers.get("x-forwarded-proto") === "https";

  // Try the expected cookie name first, then fall back to the other variant.
  // This handles the mismatch that occurs when the API route and middleware
  // disagree on whether to use the __Secure- prefix.
  const token =
    (await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
      secureCookie: isSecure,
    })) ??
    (await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
      secureCookie: !isSecure,
    }));

  // Allow cron/external calls to alert generate endpoint with CRON_SECRET
  if (req.nextUrl.pathname === "/api/alerts/generate") {
    const authHeader = req.headers.get("authorization");
    if (
      authHeader?.startsWith("Bearer ") &&
      process.env.CRON_SECRET &&
      authHeader === `Bearer ${process.env.CRON_SECRET}`
    ) {
      return NextResponse.next();
    }
  }

  // Allow webhook endpoints with their own auth (signature verification)
  const webhookPaths = ["/api/integrations/slack", "/api/integrations/jira"];
  if (webhookPaths.some((p) => req.nextUrl.pathname.startsWith(p)) && req.method === "POST") {
    // Webhook auth is handled by the route itself via signature verification
    return NextResponse.next();
  }

  if (!token) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "Authentication required", code: "AUTH_REQUIRED" },
        { status: 401 },
      );
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Enforce role-based idle timeout
  const role = token.role as string;
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");

  if (token.iat) {
    const issuedAt = (token.iat as number) * 1000;
    const idleTimeout = (IDLE_TIMEOUT_SECONDS[role] ?? IDLE_TIMEOUT_SECONDS.employee) * 1000;
    if (Date.now() - issuedAt > idleTimeout) {
      if (isApi) {
        return NextResponse.json(
          { success: false, error: "Session expired", code: "SESSION_EXPIRED" },
          { status: 401 },
        );
      }
      return NextResponse.redirect(new URL("/login?reason=session_expired", req.url));
    }
  }

  // Admin-only routes
  const adminOnlyPaths = ["/admin", "/api/users"];
  for (const restricted of adminOnlyPaths) {
    if (path.startsWith(restricted) && role !== "admin") {
      if (isApi) return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  // Admin + lead routes
  const adminLeadPaths = ["/api/scoring-config", "/api/export"];
  for (const restricted of adminLeadPaths) {
    if (path.startsWith(restricted) && !["admin", "lead"].includes(role)) {
      if (isApi) return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  // Auditor: read-only (block POST/PUT/PATCH/DELETE)
  if (role === "auditor" && isApi && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return NextResponse.json({ success: false, error: "Auditors have read-only access" }, { status: 403 });
  }

  // Add request ID and security context headers for downstream use
  const requestId = crypto.randomUUID().substring(0, 8);
  const response = NextResponse.next();
  response.headers.set("x-request-id", requestId);
  response.headers.set("x-user-role", role);
  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/employee/:path*",
    "/comms/:path*",
    "/admin/:path*",
    "/schedule/:path*",
    "/incidents/:path*",
    "/travel-rule/:path*",
    "/tokens/:path*",
    "/staking/:path*",
    "/screening/:path*",
    "/approvals/:path*",
    "/daily-checks/:path*",
    "/settlements/:path*",
    "/rca/:path*",
    "/clients/:path*",
    "/activity/:path*",
    "/projects/:path*",
    "/briefing/:path*",
    "/usdc-ramp/:path*",
    "/transactions/:path*",
    "/api/employees/:path*",
    "/api/scores/:path*",
    "/api/scoring-config/:path*",
    "/api/comms/:path*",
    "/api/audit/:path*",
    "/api/export/:path*",
    "/api/alerts/:path*",
    "/api/users/:path*",
    "/api/integrations/:path*",
    "/api/incidents/:path*",
    "/api/travel-rule/:path*",
    "/api/tokens/:path*",
    "/api/staking/:path*",
    "/api/screening/:path*",
    "/api/approvals/:path*",
    "/api/daily-checks/:path*",
    "/api/settlements/:path*",
    "/api/rca/:path*",
    "/api/clients/:path*",
    "/api/projects/:path*",
    "/api/schedule/:path*",
    "/api/activity/:path*",
    "/api/ai/:path*",
    "/api/command-center/:path*",
    "/api/usdc-ramp/:path*",
    "/api/market-data/:path*",
  ],
};
