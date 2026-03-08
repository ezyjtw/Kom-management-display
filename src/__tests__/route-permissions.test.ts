/**
 * Route-level permission tests.
 *
 * Tests the middleware enforcement of role-based access control on API routes.
 * Validates that the middleware correctly:
 *   - Returns 401 for unauthenticated requests
 *   - Blocks non-admin users from admin-only routes
 *   - Blocks non-admin/lead users from admin+lead routes
 *   - Blocks auditor mutation requests (POST/PUT/PATCH/DELETE)
 *   - Allows authorized access for correct roles
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Mock next-auth/jwt before importing middleware
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

import { getToken } from "next-auth/jwt";
import { middleware } from "@/middleware";

const mockedGetToken = vi.mocked(getToken);

// ─── Helpers ───

const BASE_URL = "http://localhost:3000";

function makeRequest(path: string, method = "GET", headers?: Record<string, string>): NextRequest {
  const url = new URL(path, BASE_URL);
  return new NextRequest(url, {
    method,
    headers: {
      // Provide origin to avoid CSRF rejection in production-like scenarios
      origin: BASE_URL,
      ...headers,
    },
  });
}

interface TokenPayload {
  role: string;
  sub?: string;
  name?: string;
  email?: string;
  iat?: number;
  [key: string]: unknown;
}

function mockToken(token: TokenPayload | null): void {
  mockedGetToken.mockResolvedValue(token as any);
}

function freshToken(role: string): TokenPayload {
  return {
    role,
    sub: "user-1",
    name: "Test User",
    email: "test@example.com",
    // Issue time: now (in seconds), well within any idle timeout
    iat: Math.floor(Date.now() / 1000),
  };
}

// ─── Unauthenticated access (401) ───

describe("Unauthenticated requests return 401", () => {
  beforeEach(() => {
    mockToken(null);
  });

  const criticalRoutes = [
    "/api/users",
    "/api/employees",
    "/api/scores",
    "/api/scoring-config",
    "/api/export",
    "/api/comms",
    "/api/audit",
    "/api/alerts",
    "/api/incidents",
    "/api/travel-rule",
    "/api/tokens",
    "/api/staking",
    "/api/settlements",
    "/api/feature-flags",
  ];

  for (const route of criticalRoutes) {
    it(`GET ${route} returns 401`, async () => {
      const req = makeRequest(`${route}/test`);
      const res = await middleware(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.code).toBe("AUTH_REQUIRED");
    });
  }

  it("POST /api/employees/test returns 401", async () => {
    const req = makeRequest("/api/employees/test", "POST");
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it("DELETE /api/users/test returns 401", async () => {
    const req = makeRequest("/api/users/test", "DELETE");
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });
});

// ─── Admin-only routes (/api/users) ───

describe("Admin-only routes (/api/users)", () => {
  it("admin can access GET /api/users/test", async () => {
    mockToken(freshToken("admin"));
    const req = makeRequest("/api/users/test");
    const res = await middleware(req);
    // Should pass through (200 from NextResponse.next())
    expect(res.status).toBe(200);
  });

  it("admin can POST to /api/users/test", async () => {
    mockToken(freshToken("admin"));
    const req = makeRequest("/api/users/test", "POST");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("lead gets 403 on GET /api/users/test", async () => {
    mockToken(freshToken("lead"));
    const req = makeRequest("/api/users/test");
    const res = await middleware(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Admin");
  });

  it("employee gets 403 on GET /api/users/test", async () => {
    mockToken(freshToken("employee"));
    const req = makeRequest("/api/users/test");
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });

  it("auditor gets 403 on GET /api/users/test", async () => {
    mockToken(freshToken("auditor"));
    const req = makeRequest("/api/users/test");
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });
});

// ─── Admin + lead routes (/api/scoring-config, /api/export) ───

describe("Admin + lead routes (/api/scoring-config)", () => {
  it("admin can access GET /api/scoring-config/test", async () => {
    mockToken(freshToken("admin"));
    const req = makeRequest("/api/scoring-config/test");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("lead can access GET /api/scoring-config/test", async () => {
    mockToken(freshToken("lead"));
    const req = makeRequest("/api/scoring-config/test");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("employee gets 403 on GET /api/scoring-config/test", async () => {
    mockToken(freshToken("employee"));
    const req = makeRequest("/api/scoring-config/test");
    const res = await middleware(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Insufficient permissions");
  });

  it("auditor gets 403 on GET /api/scoring-config/test", async () => {
    mockToken(freshToken("auditor"));
    const req = makeRequest("/api/scoring-config/test");
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });
});

describe("Admin + lead routes (/api/export)", () => {
  it("admin can access GET /api/export/test", async () => {
    mockToken(freshToken("admin"));
    const req = makeRequest("/api/export/test");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("lead can access GET /api/export/test", async () => {
    mockToken(freshToken("lead"));
    const req = makeRequest("/api/export/test");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("employee gets 403 on GET /api/export/test", async () => {
    mockToken(freshToken("employee"));
    const req = makeRequest("/api/export/test");
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });

  it("auditor gets 403 on GET /api/export/test", async () => {
    mockToken(freshToken("auditor"));
    const req = makeRequest("/api/export/test");
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });
});

// ─── Auditor read-only enforcement ───

describe("Auditor read-only enforcement (mutation methods blocked)", () => {
  beforeEach(() => {
    mockToken(freshToken("auditor"));
  });

  const mutationMethods = ["POST", "PUT", "PATCH", "DELETE"] as const;

  // Routes that auditors should NOT be able to mutate
  const generalRoutes = [
    "/api/employees/test",
    "/api/scores/test",
    "/api/incidents/test",
    "/api/travel-rule/test",
    "/api/staking/test",
    "/api/settlements/test",
    "/api/comms/test",
    "/api/alerts/test",
    "/api/daily-checks/test",
    "/api/projects/test",
    "/api/feature-flags/test",
    "/api/transaction-confirmations/test",
  ];

  for (const method of mutationMethods) {
    for (const route of generalRoutes) {
      it(`${method} ${route} returns 403 for auditor`, async () => {
        const req = makeRequest(route, method);
        const res = await middleware(req);
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toContain("read-only");
      });
    }
  }

  it("auditor CAN use GET on general routes", async () => {
    for (const route of generalRoutes) {
      const req = makeRequest(route);
      const res = await middleware(req);
      // Should pass through (not blocked by middleware)
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    }
  });
});

// ─── Non-auditor roles can mutate general routes ───

describe("Non-auditor roles can mutate general routes", () => {
  const mutationMethods = ["POST", "PUT", "PATCH", "DELETE"] as const;

  // These are routes that are NOT admin-only or admin+lead-only
  const generalRoutes = [
    "/api/employees/test",
    "/api/scores/test",
    "/api/incidents/test",
    "/api/comms/test",
  ];

  for (const role of ["admin", "lead", "employee"] as const) {
    for (const method of mutationMethods) {
      it(`${role} can ${method} on general routes`, async () => {
        mockToken(freshToken(role));
        const req = makeRequest(generalRoutes[0], method);
        const res = await middleware(req);
        // Should not be blocked by role/method checks
        expect(res.status).not.toBe(403);
        expect(res.status).not.toBe(401);
      });
    }
  }
});

// ─── Admin can mutate admin-only routes ───

describe("Admin can mutate admin-only routes", () => {
  beforeEach(() => {
    mockToken(freshToken("admin"));
  });

  const mutationMethods = ["POST", "PUT", "PATCH", "DELETE"] as const;

  for (const method of mutationMethods) {
    it(`admin can ${method} /api/users/test`, async () => {
      const req = makeRequest("/api/users/test", method);
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });
  }
});

// ─── Employee cannot access admin or admin+lead routes ───

describe("Employee is blocked from privileged routes", () => {
  beforeEach(() => {
    mockToken(freshToken("employee"));
  });

  it("employee gets 403 on /api/users/test (admin-only)", async () => {
    const req = makeRequest("/api/users/test");
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });

  it("employee gets 403 on /api/scoring-config/test (admin+lead)", async () => {
    const req = makeRequest("/api/scoring-config/test");
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });

  it("employee gets 403 on /api/export/test (admin+lead)", async () => {
    const req = makeRequest("/api/export/test");
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });

  it("employee can access general routes like /api/employees/test", async () => {
    const req = makeRequest("/api/employees/test");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("employee can access /api/incidents/test", async () => {
    const req = makeRequest("/api/incidents/test");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});

// ─── Security headers are present on all responses ───

describe("Security headers are applied", () => {
  it("401 response includes security headers", async () => {
    mockToken(null);
    const req = makeRequest("/api/employees/test");
    const res = await middleware(req);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-XSS-Protection")).toBe("1; mode=block");
  });

  it("403 response includes security headers", async () => {
    mockToken(freshToken("employee"));
    const req = makeRequest("/api/users/test");
    const res = await middleware(req);
    expect(res.status).toBe(403);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("successful response includes security headers", async () => {
    mockToken(freshToken("admin"));
    const req = makeRequest("/api/employees/test");
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

// ─── Correlation ID is set on successful requests ───

describe("Correlation ID is set on pass-through requests", () => {
  it("successful request gets a correlation ID header", async () => {
    mockToken(freshToken("admin"));
    const req = makeRequest("/api/employees/test");
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-correlation-id")).toBeTruthy();
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("user role header is set on pass-through", async () => {
    mockToken(freshToken("lead"));
    const req = makeRequest("/api/employees/test");
    const res = await middleware(req);
    expect(res.headers.get("x-user-role")).toBe("lead");
  });
});

// ─── Session expiry enforcement ───

describe("Session expiry enforcement", () => {
  it("expired admin session returns 401", async () => {
    // Admin idle timeout is 2 hours. Set iat to 3 hours ago.
    const expiredToken = freshToken("admin");
    expiredToken.iat = Math.floor(Date.now() / 1000) - 3 * 60 * 60;
    mockToken(expiredToken);

    const req = makeRequest("/api/employees/test");
    const res = await middleware(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("SESSION_EXPIRED");
  });

  it("fresh admin session passes through", async () => {
    mockToken(freshToken("admin"));
    const req = makeRequest("/api/employees/test");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("expired employee session returns 401 (8h timeout)", async () => {
    const expiredToken = freshToken("employee");
    expiredToken.iat = Math.floor(Date.now() / 1000) - 9 * 60 * 60;
    mockToken(expiredToken);

    const req = makeRequest("/api/employees/test");
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });
});
