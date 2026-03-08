import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

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

  if (!token) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Route-level role restrictions
  const role = token.role as string;
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");

  // Admin-only routes
  const adminOnlyPaths = ["/admin", "/api/users"];
  for (const restricted of adminOnlyPaths) {
    if (path.startsWith(restricted) && role !== "admin") {
      if (isApi) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  // Admin + lead routes
  const adminLeadPaths = ["/api/scoring-config", "/api/export"];
  for (const restricted of adminLeadPaths) {
    if (path.startsWith(restricted) && !["admin", "lead"].includes(role)) {
      if (isApi) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  // Auditor: read-only (block POST/PUT/PATCH/DELETE)
  if (role === "auditor" && isApi && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return NextResponse.json({ error: "Auditors have read-only access" }, { status: 403 });
  }

  // Add request ID header for correlation
  const requestId = crypto.randomUUID().substring(0, 8);
  const response = NextResponse.next();
  response.headers.set("x-request-id", requestId);
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
  ],
};
