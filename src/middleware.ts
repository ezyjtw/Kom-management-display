import { withAuth } from "next-auth/middleware";
import { NextRequest, NextResponse } from "next/server";

export default withAuth({
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized: ({ token, req }) => {
      // Allow cron/external calls to alert generate endpoint with CRON_SECRET
      if (req.nextUrl.pathname === "/api/alerts/generate") {
        const authHeader = req.headers.get("authorization");
        if (authHeader?.startsWith("Bearer ") && process.env.CRON_SECRET) {
          return authHeader === `Bearer ${process.env.CRON_SECRET}`;
        }
      }
      // All other routes require a valid session
      return !!token;
    },
  },
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/employee/:path*",
    "/comms/:path*",
    "/admin/:path*",
    "/api/employees/:path*",
    "/api/scores/:path*",
    "/api/scoring-config/:path*",
    "/api/comms/:path*",
    "/api/audit/:path*",
    "/api/export/:path*",
    "/api/alerts/:path*",
    "/api/users/:path*",
    "/api/integrations/:path*",
  ],
};
