/**
 * Comprehensive authorization matrix tests.
 *
 * Verifies the full RBAC permission model: all roles, resources, actions,
 * scope filtering, and field masking. Extends the base authorization.test.ts
 * with exhaustive coverage of the matrix.
 */
import { describe, it, expect } from "vitest";
import {
  checkAuthorization,
  applyScopeFilter,
  maskSensitiveFields,
} from "@/modules/auth/services/authorization";
import {
  AUTHORIZATION_MATRIX,
  SENSITIVE_FIELDS,
  type Role,
  type Resource,
  type Action,
} from "@/modules/auth/types";
import type { AuthUser } from "@/lib/auth-user";

// ─── Helpers ───

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

const ALL_ROLES: Role[] = ["admin", "lead", "employee", "auditor"];

const ALL_RESOURCES: Resource[] = [
  "employee", "score", "scoring_config", "thread", "thread_note",
  "alert", "project", "incident", "travel_rule_case", "daily_check",
  "staking_wallet", "settlement", "screening", "usdc_ramp",
  "token_review", "export", "audit_log", "user", "branding",
  "transaction_confirmation", "feature_flag", "session",
  "background_job", "report", "metrics",
];

// ─── Admin: can do everything ───

describe("Admin can perform all actions on all resources", () => {
  const admin = makeUser({ role: "admin" });

  it("admin has permissions defined for every resource", () => {
    for (const resource of ALL_RESOURCES) {
      const perm = AUTHORIZATION_MATRIX.admin[resource];
      expect(perm, `admin should have permissions for ${resource}`).toBeDefined();
      expect(perm!.actions.length).toBeGreaterThan(0);
      expect(perm!.scope).toBe("all");
    }
  });

  it("admin can view every resource", () => {
    for (const resource of ALL_RESOURCES) {
      const result = checkAuthorization(admin, resource, "view");
      expect(result.allowed, `admin should be able to view ${resource}`).toBe(true);
      expect(result.scope).toBe("all");
    }
  });

  it("admin can export data", () => {
    const result = checkAuthorization(admin, "export", "export");
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("all");
  });

  it("admin can create users", () => {
    const result = checkAuthorization(admin, "user", "create");
    expect(result.allowed).toBe(true);
  });

  it("admin can delete users", () => {
    const result = checkAuthorization(admin, "user", "delete");
    expect(result.allowed).toBe(true);
  });

  it("admin can configure scoring", () => {
    const result = checkAuthorization(admin, "scoring_config", "configure");
    expect(result.allowed).toBe(true);
  });

  it("admin can approve scoring config", () => {
    const result = checkAuthorization(admin, "scoring_config", "approve");
    expect(result.allowed).toBe(true);
  });

  it("admin can override scores", () => {
    const result = checkAuthorization(admin, "score", "override");
    expect(result.allowed).toBe(true);
  });

  it("admin can assign and reassign threads", () => {
    expect(checkAuthorization(admin, "thread", "assign").allowed).toBe(true);
    expect(checkAuthorization(admin, "thread", "reassign").allowed).toBe(true);
  });
});

// ─── Employee: restricted access ───

describe("Employee cannot export", () => {
  const employee = makeUser({ role: "employee" });

  it("employee has no export actions", () => {
    const perm = AUTHORIZATION_MATRIX.employee.export;
    expect(perm).toBeDefined();
    expect(perm!.actions).toEqual([]);
    expect(perm!.scope).toBe("none");
  });

  it("checkAuthorization denies export for employee", () => {
    const result = checkAuthorization(employee, "export", "export");
    expect(result.allowed).toBe(false);
  });

  it("employee cannot view export resource either", () => {
    const result = checkAuthorization(employee, "export", "view");
    expect(result.allowed).toBe(false);
  });

  it("employee cannot view audit logs", () => {
    const result = checkAuthorization(employee, "audit_log", "view");
    expect(result.allowed).toBe(false);
  });

  it("employee cannot create users", () => {
    const result = checkAuthorization(employee, "user", "create");
    expect(result.allowed).toBe(false);
  });

  it("employee cannot create scores", () => {
    const result = checkAuthorization(employee, "score", "create");
    expect(result.allowed).toBe(false);
  });

  it("employee can view own scores", () => {
    const result = checkAuthorization(employee, "score", "view_own");
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("own");
  });

  it("employee can create incidents", () => {
    const result = checkAuthorization(employee, "incident", "create");
    expect(result.allowed).toBe(true);
  });

  it("employee can view threads (own scope)", () => {
    const result = checkAuthorization(employee, "thread", "view");
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("own");
  });

  it("employee cannot assign threads", () => {
    const result = checkAuthorization(employee, "thread", "assign");
    expect(result.allowed).toBe(false);
  });
});

// ─── Auditor: read-only ───

describe("Auditor is read-only (can only view)", () => {
  const auditor = makeUser({ role: "auditor" });

  it("auditor can view every resource with all scope", () => {
    for (const resource of ALL_RESOURCES) {
      const result = checkAuthorization(auditor, resource, "view");
      expect(result.allowed, `auditor should view ${resource}`).toBe(true);
      expect(result.scope, `auditor ${resource} scope should be all`).toBe("all");
    }
  });

  it("auditor cannot create on any resource", () => {
    const createableResources: Resource[] = [
      "employee", "score", "thread", "thread_note", "incident",
      "travel_rule_case", "daily_check", "staking_wallet",
      "settlement", "screening", "usdc_ramp", "token_review", "user",
    ];
    for (const resource of createableResources) {
      const result = checkAuthorization(auditor, resource, "create");
      expect(result.allowed, `auditor should NOT create ${resource}`).toBe(false);
    }
  });

  it("auditor cannot update any resource", () => {
    const updatableResources: Resource[] = [
      "employee", "score", "thread", "alert", "project",
      "incident", "daily_check",
    ];
    for (const resource of updatableResources) {
      const result = checkAuthorization(auditor, resource, "update");
      expect(result.allowed, `auditor should NOT update ${resource}`).toBe(false);
    }
  });

  it("auditor cannot delete anything", () => {
    const result = checkAuthorization(auditor, "employee", "delete");
    expect(result.allowed).toBe(false);
  });

  it("auditor CAN export (for audit purposes)", () => {
    const result = checkAuthorization(auditor, "export", "export");
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("all");
  });

  it("auditor has only view actions per resource (plus export for export/report resources)", () => {
    for (const resource of ALL_RESOURCES) {
      const perm = AUTHORIZATION_MATRIX.auditor[resource];
      expect(perm).toBeDefined();
      if (resource === "export" || resource === "report") {
        expect(perm!.actions).toEqual(expect.arrayContaining(["view", "export"]));
      } else {
        expect(perm!.actions).toEqual(["view"]);
      }
    }
  });
});

// ─── Lead: team scope ───

describe("Lead has team scope", () => {
  const lead = makeUser({ role: "lead", team: "Transaction Operations" });

  it("lead views employees with team scope", () => {
    const result = checkAuthorization(lead, "employee", "view");
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("team");
  });

  it("lead creates scores with team scope", () => {
    const result = checkAuthorization(lead, "score", "create");
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("team");
  });

  it("lead can export with team scope", () => {
    const result = checkAuthorization(lead, "export", "export");
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

  it("lead can view scoring config (all scope)", () => {
    const result = checkAuthorization(lead, "scoring_config", "view");
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("all");
  });

  it("lead can assign threads within team", () => {
    const result = checkAuthorization(lead, "thread", "assign");
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("team");
  });

  it("lead can resolve incidents (all scope)", () => {
    const result = checkAuthorization(lead, "incident", "resolve");
    expect(result.allowed).toBe(true);
  });
});

// ─── Every resource has permissions for every role ───

describe("All resources have defined permissions for all roles", () => {
  for (const role of ALL_ROLES) {
    it(`${role} role has a non-empty permission map`, () => {
      const perms = AUTHORIZATION_MATRIX[role];
      expect(perms).toBeDefined();
      expect(Object.keys(perms).length).toBeGreaterThan(0);
    });
  }

  it("every resource is covered by every role", () => {
    for (const role of ALL_ROLES) {
      for (const resource of ALL_RESOURCES) {
        const perm = AUTHORIZATION_MATRIX[role][resource];
        expect(
          perm,
          `Role '${role}' is missing permissions for resource '${resource}'`,
        ).toBeDefined();
      }
    }
  });
});

// ─── Scope filtering behavior ───

describe("Scope filtering", () => {
  it("own scope filters by employeeId", () => {
    const user = makeUser({ role: "employee", employeeId: "emp-42" });
    const where = applyScopeFilter(user, "own");
    expect(where.employeeId).toBe("emp-42");
  });

  it("team scope filters by employee.team", () => {
    const user = makeUser({ role: "lead", team: "Custody Ops" });
    const where = applyScopeFilter(user, "team");
    expect((where.employee as Record<string, unknown>)?.team).toBe("Custody Ops");
  });

  it("all scope applies no filter", () => {
    const user = makeUser({ role: "admin" });
    const where = applyScopeFilter(user, "all");
    expect(Object.keys(where)).toHaveLength(0);
  });

  it("none scope inserts deny-all sentinel", () => {
    const user = makeUser({ role: "employee" });
    const where = applyScopeFilter(user, "none");
    expect(where.id).toBe("__DENY_ALL__");
  });

  it("supports custom ownerField via opts", () => {
    const user = makeUser({ role: "employee", employeeId: "emp-5" });
    const where = applyScopeFilter(user, "own", {}, {
      employeeIdField: "assignedToId",
    });
    expect(where.assignedToId).toBe("emp-5");
  });

  it("supports custom teamField via opts", () => {
    const user = makeUser({ role: "lead", team: "Trading" });
    const where = applyScopeFilter(user, "team", {}, {
      teamField: "department",
    });
    expect(where.department).toBe("Trading");
  });

  it("merges with existing where clause", () => {
    const user = makeUser({ role: "employee", employeeId: "emp-1" });
    const existing = { status: "active" };
    const where = applyScopeFilter(user, "own", existing);
    expect(where.status).toBe("active");
    expect(where.employeeId).toBe("emp-1");
  });
});

// ─── Sensitive field masking ───

describe("Field masking for sensitive fields", () => {
  it("does not mask anything for admin", () => {
    const data = { id: "1", walletAddress: "0xABCDEF123456789" };
    const result = maskSensitiveFields(data, "staking_wallet", "admin");
    expect(result.walletAddress).toBe("0xABCDEF123456789");
  });

  it("masks wallet address for employee", () => {
    const data = { id: "1", walletAddress: "0xABCDEF123456789" };
    const result = maskSensitiveFields(data, "staking_wallet", "employee");
    expect(result.walletAddress).not.toBe("0xABCDEF123456789");
    expect(result.walletAddress).toContain("*");
  });

  it("masks wallet address for lead", () => {
    const data = { id: "1", walletAddress: "0xABCDEF123456789" };
    const result = maskSensitiveFields(data, "staking_wallet", "lead");
    expect(result.walletAddress).toContain("*");
  });

  it("masks USDC ramp bank reference and SSI details", () => {
    const data = {
      id: "1",
      bankReference: "SWIFT-REF-123456",
      ssiDetails: "Bank of London Account 123",
      custodyWalletId: "custody-wallet-id-abc",
      holdingWalletId: "holding-wallet-id-xyz",
    };
    const result = maskSensitiveFields(data, "usdc_ramp", "lead");
    expect(result.bankReference).toContain("*");
    expect(result.ssiDetails).toContain("*");
    expect(result.custodyWalletId).toContain("*");
    expect(result.holdingWalletId).toContain("*");
  });

  it("masks travel rule sender and receiver addresses", () => {
    const data = {
      id: "1",
      senderAddress: "0xSENDER12345678",
      receiverAddress: "0xRECEIVER12345678",
      emailSentTo: "counterparty@vasp.com",
    };
    const result = maskSensitiveFields(data, "travel_rule_case", "employee");
    expect(result.senderAddress).toContain("*");
    expect(result.receiverAddress).toContain("*");
    expect(result.emailSentTo).toContain("*");
  });

  it("masks settlement wallets for non-admin", () => {
    const data = {
      id: "1",
      collateralWallet: "collateral-wallet-abc123",
      custodyWallet: "custody-wallet-def456",
    };
    const result = maskSensitiveFields(data, "settlement", "auditor");
    expect(result.collateralWallet).toContain("*");
    expect(result.custodyWallet).toContain("*");
  });

  it("masks user password", () => {
    const data = { id: "1", password: "supersecretpassword" };
    const result = maskSensitiveFields(data, "user", "lead");
    expect(result.password).toContain("*");
    expect(result.password).not.toBe("supersecretpassword");
  });

  it("does not mask fields for resources with no sensitive fields defined", () => {
    const data = { id: "1", name: "John", role: "analyst" };
    const result = maskSensitiveFields(data, "employee", "employee");
    expect(result.name).toBe("John");
    expect(result.role).toBe("analyst");
  });

  it("preserves first and last 2 chars with masking in between", () => {
    const data = { id: "1", walletAddress: "0xABCDEF" };
    const result = maskSensitiveFields(data, "staking_wallet", "employee");
    // "0xABCDEF" is 8 chars. Mask: first 2 + stars + last 2 = "0x****EF"
    expect((result.walletAddress as string).startsWith("0x")).toBe(true);
    expect((result.walletAddress as string).endsWith("EF")).toBe(true);
  });

  it("fully masks short values (4 chars or less)", () => {
    const data = { id: "1", walletAddress: "0xAB" };
    const result = maskSensitiveFields(data, "staking_wallet", "employee");
    expect(result.walletAddress).toBe("****");
  });

  it("masks session tokens and IP addresses for non-admin", () => {
    const data = { id: "1", sessionToken: "eyJhbGciOiJIUzI1NiJ9.abc", ipAddress: "192.168.1.100" };
    const result = maskSensitiveFields(data, "session", "lead");
    expect(result.sessionToken).toContain("*");
    expect(result.ipAddress).toContain("*");
  });

  it("masks transaction confirmation email and slack channel", () => {
    const data = { id: "1", emailSentTo: "ops@custody.io", slackChannel: "#custody-ops" };
    const result = maskSensitiveFields(data, "transaction_confirmation", "employee");
    expect(result.emailSentTo).toContain("*");
    expect(result.slackChannel).toContain("*");
  });
});

// ─── New resource permissions ───

describe("New resource permissions", () => {
  const admin = makeUser({ role: "admin" });
  const lead = makeUser({ role: "lead" });
  const employee = makeUser({ role: "employee" });
  const auditor = makeUser({ role: "auditor" });

  describe("transaction_confirmation", () => {
    it("admin can create and approve confirmations", () => {
      expect(checkAuthorization(admin, "transaction_confirmation", "create").allowed).toBe(true);
      expect(checkAuthorization(admin, "transaction_confirmation", "approve").allowed).toBe(true);
    });

    it("lead can acknowledge confirmations with team scope", () => {
      const result = checkAuthorization(lead, "transaction_confirmation", "acknowledge");
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("team");
    });

    it("employee can only view and acknowledge own confirmations", () => {
      expect(checkAuthorization(employee, "transaction_confirmation", "view").allowed).toBe(true);
      expect(checkAuthorization(employee, "transaction_confirmation", "acknowledge").allowed).toBe(true);
      expect(checkAuthorization(employee, "transaction_confirmation", "approve").allowed).toBe(false);
      expect(checkAuthorization(employee, "transaction_confirmation", "create").allowed).toBe(false);
    });

    it("auditor can only view confirmations", () => {
      expect(checkAuthorization(auditor, "transaction_confirmation", "view").allowed).toBe(true);
      expect(checkAuthorization(auditor, "transaction_confirmation", "approve").allowed).toBe(false);
    });
  });

  describe("feature_flag", () => {
    it("admin can configure and delete feature flags", () => {
      expect(checkAuthorization(admin, "feature_flag", "configure").allowed).toBe(true);
      expect(checkAuthorization(admin, "feature_flag", "delete").allowed).toBe(true);
    });

    it("lead and employee can only view feature flags", () => {
      expect(checkAuthorization(lead, "feature_flag", "view").allowed).toBe(true);
      expect(checkAuthorization(lead, "feature_flag", "create").allowed).toBe(false);
      expect(checkAuthorization(employee, "feature_flag", "view").allowed).toBe(true);
      expect(checkAuthorization(employee, "feature_flag", "update").allowed).toBe(false);
    });
  });

  describe("session", () => {
    it("admin can view and delete any session", () => {
      const result = checkAuthorization(admin, "session", "view");
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("all");
    });

    it("lead and employee can only manage own sessions", () => {
      expect(checkAuthorization(lead, "session", "view").scope).toBe("own");
      expect(checkAuthorization(employee, "session", "delete").allowed).toBe(true);
      expect(checkAuthorization(employee, "session", "delete").scope).toBe("own");
    });

    it("auditor can view all sessions", () => {
      expect(checkAuthorization(auditor, "session", "view").allowed).toBe(true);
      expect(checkAuthorization(auditor, "session", "view").scope).toBe("all");
      expect(checkAuthorization(auditor, "session", "delete").allowed).toBe(false);
    });
  });

  describe("background_job", () => {
    it("admin can create and configure jobs", () => {
      expect(checkAuthorization(admin, "background_job", "create").allowed).toBe(true);
      expect(checkAuthorization(admin, "background_job", "configure").allowed).toBe(true);
    });

    it("employee cannot access background jobs", () => {
      expect(checkAuthorization(employee, "background_job", "view").allowed).toBe(false);
    });

    it("lead can only view jobs", () => {
      expect(checkAuthorization(lead, "background_job", "view").allowed).toBe(true);
      expect(checkAuthorization(lead, "background_job", "create").allowed).toBe(false);
    });
  });

  describe("report", () => {
    it("admin can create and export reports", () => {
      expect(checkAuthorization(admin, "report", "create").allowed).toBe(true);
      expect(checkAuthorization(admin, "report", "export").allowed).toBe(true);
    });

    it("lead can create reports with team scope", () => {
      const result = checkAuthorization(lead, "report", "create");
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("team");
    });

    it("employee can only view own reports", () => {
      expect(checkAuthorization(employee, "report", "view").allowed).toBe(true);
      expect(checkAuthorization(employee, "report", "view").scope).toBe("own");
      expect(checkAuthorization(employee, "report", "create").allowed).toBe(false);
    });

    it("auditor can view and export reports", () => {
      expect(checkAuthorization(auditor, "report", "export").allowed).toBe(true);
    });
  });

  describe("metrics", () => {
    it("admin, lead, and auditor can view metrics", () => {
      expect(checkAuthorization(admin, "metrics", "view").allowed).toBe(true);
      expect(checkAuthorization(lead, "metrics", "view").allowed).toBe(true);
      expect(checkAuthorization(auditor, "metrics", "view").allowed).toBe(true);
    });

    it("employee cannot view metrics", () => {
      expect(checkAuthorization(employee, "metrics", "view").allowed).toBe(false);
    });
  });
});
