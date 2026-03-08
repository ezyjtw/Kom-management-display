/**
 * Authorization matrix tests.
 *
 * Verifies the RBAC permission model for all roles, resources, and actions.
 */
import { describe, it, expect } from "vitest";
import {
  checkAuthorization,
  applyScopeFilter,
  maskSensitiveFields,
} from "@/modules/auth/services/authorization";
import { AUTHORIZATION_MATRIX, type Role, type Resource, type Action } from "@/modules/auth/types";
import type { AuthUser } from "@/lib/auth-user";

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    role: "employee",
    employeeId: "emp-1",
    team: "Transaction Operations",
    ...overrides,
  };
}

describe("Authorization Matrix", () => {
  describe("Admin permissions", () => {
    const admin = makeUser({ role: "admin" });

    it("admin can view all employees", () => {
      const result = checkAuthorization(admin, "employee", "view");
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("all");
    });

    it("admin can create users", () => {
      const result = checkAuthorization(admin, "user", "create");
      expect(result.allowed).toBe(true);
    });

    it("admin can configure scoring", () => {
      const result = checkAuthorization(admin, "scoring_config", "configure");
      expect(result.allowed).toBe(true);
    });

    it("admin can export data", () => {
      const result = checkAuthorization(admin, "export", "export");
      expect(result.allowed).toBe(true);
    });

    it("admin can view audit logs", () => {
      const result = checkAuthorization(admin, "audit_log", "view");
      expect(result.allowed).toBe(true);
    });
  });

  describe("Lead permissions", () => {
    const lead = makeUser({ role: "lead" });

    it("lead can view team employees", () => {
      const result = checkAuthorization(lead, "employee", "view");
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("team");
    });

    it("lead can create scores for team", () => {
      const result = checkAuthorization(lead, "score", "create");
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("team");
    });

    it("lead cannot create users", () => {
      const result = checkAuthorization(lead, "user", "create");
      expect(result.allowed).toBe(false);
    });

    it("lead cannot configure scoring", () => {
      const result = checkAuthorization(lead, "scoring_config", "configure");
      expect(result.allowed).toBe(false);
    });

    it("lead can export team data", () => {
      const result = checkAuthorization(lead, "export", "export");
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("team");
    });
  });

  describe("Employee permissions", () => {
    const employee = makeUser({ role: "employee" });

    it("employee can view own scores", () => {
      const result = checkAuthorization(employee, "score", "view_own");
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("own");
    });

    it("employee cannot view all scores", () => {
      const result = checkAuthorization(employee, "score", "view");
      expect(result.allowed).toBe(false);
    });

    it("employee cannot export", () => {
      const result = checkAuthorization(employee, "export", "export");
      expect(result.allowed).toBe(false);
    });

    it("employee cannot view audit logs", () => {
      const result = checkAuthorization(employee, "audit_log", "view");
      expect(result.allowed).toBe(false);
    });

    it("employee can view threads (own scope)", () => {
      const result = checkAuthorization(employee, "thread", "view");
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("own");
    });

    it("employee can create incidents", () => {
      const result = checkAuthorization(employee, "incident", "create");
      expect(result.allowed).toBe(true);
    });
  });

  describe("Auditor permissions", () => {
    const auditor = makeUser({ role: "auditor" });

    it("auditor can view everything", () => {
      const resources: Resource[] = [
        "employee", "score", "thread", "alert", "incident",
        "travel_rule_case", "audit_log", "export",
      ];
      for (const resource of resources) {
        const result = checkAuthorization(auditor, resource, "view");
        expect(result.allowed).toBe(true);
        expect(result.scope).toBe("all");
      }
    });

    it("auditor cannot create anything", () => {
      const resources: Resource[] = ["employee", "score", "thread", "incident"];
      for (const resource of resources) {
        const result = checkAuthorization(auditor, resource, "create");
        expect(result.allowed).toBe(false);
      }
    });

    it("auditor can export for audit purposes", () => {
      const result = checkAuthorization(auditor, "export", "export");
      expect(result.allowed).toBe(true);
    });
  });

  describe("All resources have permissions for all roles", () => {
    const roles: Role[] = ["admin", "lead", "employee", "auditor"];

    it("every role has a defined permission set", () => {
      for (const role of roles) {
        expect(AUTHORIZATION_MATRIX[role]).toBeDefined();
        expect(Object.keys(AUTHORIZATION_MATRIX[role]!).length).toBeGreaterThan(0);
      }
    });
  });
});

describe("Scope filtering", () => {
  it("applies own scope with employeeId", () => {
    const user = makeUser({ role: "employee", employeeId: "emp-1" });
    const where = applyScopeFilter(user, "own");
    expect(where.employeeId).toBe("emp-1");
  });

  it("applies team scope with team filter", () => {
    const user = makeUser({ role: "lead", team: "Transaction Operations" });
    const where = applyScopeFilter(user, "team");
    expect((where.employee as Record<string, unknown>)?.team).toBe("Transaction Operations");
  });

  it("applies no filter for 'all' scope", () => {
    const user = makeUser({ role: "admin" });
    const where = applyScopeFilter(user, "all");
    expect(Object.keys(where).length).toBe(0);
  });

  it("denies all for 'none' scope", () => {
    const user = makeUser({ role: "employee" });
    const where = applyScopeFilter(user, "none");
    expect(where.id).toBe("__DENY_ALL__");
  });
});

describe("Sensitive field masking", () => {
  it("masks wallet addresses for non-admin", () => {
    const data = { id: "1", walletAddress: "0x1234567890abcdef" };
    const masked = maskSensitiveFields(data, "staking_wallet", "employee");
    expect(masked.walletAddress).not.toBe("0x1234567890abcdef");
    expect(masked.walletAddress).toContain("*");
  });

  it("does not mask for admin", () => {
    const data = { id: "1", walletAddress: "0x1234567890abcdef" };
    const masked = maskSensitiveFields(data, "staking_wallet", "admin");
    expect(masked.walletAddress).toBe("0x1234567890abcdef");
  });

  it("masks USDC ramp bank references", () => {
    const data = { id: "1", bankReference: "SWIFT-REF-123456", ssiDetails: "Bank of London" };
    const masked = maskSensitiveFields(data, "usdc_ramp", "lead");
    expect(masked.bankReference).toContain("*");
    expect(masked.ssiDetails).toContain("*");
  });
});
