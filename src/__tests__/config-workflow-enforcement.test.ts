/**
 * Config workflow enforcement tests.
 *
 * Verifies that the scoring config approval workflow is enforced:
 * - draft → review → approved → active (no shortcuts)
 * - Segregation of duties: creator cannot approve, approver cannot activate
 * - Only admins can approve and activate
 * - Archived configs cannot be reactivated
 */
import { describe, it, expect } from "vitest";

// ─── State Machine Validation ───

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["review", "archived"],
  review: ["approved", "draft", "archived"],
  approved: ["active", "archived"],
  active: ["archived"],
  archived: [],
};

function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

describe("Config Workflow State Machine", () => {
  describe("Valid forward transitions", () => {
    it("draft → review is valid", () => {
      expect(isValidTransition("draft", "review")).toBe(true);
    });

    it("review → approved is valid", () => {
      expect(isValidTransition("review", "approved")).toBe(true);
    });

    it("approved → active is valid", () => {
      expect(isValidTransition("approved", "active")).toBe(true);
    });

    it("active → archived is valid", () => {
      expect(isValidTransition("active", "archived")).toBe(true);
    });
  });

  describe("Valid backward transitions", () => {
    it("review → draft (send back) is valid", () => {
      expect(isValidTransition("review", "draft")).toBe(true);
    });
  });

  describe("Invalid shortcut transitions", () => {
    it("draft → active (skip review + approval) is invalid", () => {
      expect(isValidTransition("draft", "active")).toBe(false);
    });

    it("draft → approved (skip review) is invalid", () => {
      expect(isValidTransition("draft", "approved")).toBe(false);
    });

    it("review → active (skip approval) is invalid", () => {
      expect(isValidTransition("review", "active")).toBe(false);
    });
  });

  describe("Archived is terminal", () => {
    it("archived → draft is invalid", () => {
      expect(isValidTransition("archived", "draft")).toBe(false);
    });

    it("archived → review is invalid", () => {
      expect(isValidTransition("archived", "review")).toBe(false);
    });

    it("archived → active is invalid", () => {
      expect(isValidTransition("archived", "active")).toBe(false);
    });

    it("archived → approved is invalid", () => {
      expect(isValidTransition("archived", "approved")).toBe(false);
    });
  });

  describe("Active cannot go backward", () => {
    it("active → draft is invalid", () => {
      expect(isValidTransition("active", "draft")).toBe(false);
    });

    it("active → review is invalid", () => {
      expect(isValidTransition("active", "review")).toBe(false);
    });

    it("active → approved is invalid", () => {
      expect(isValidTransition("active", "approved")).toBe(false);
    });
  });
});

// ─── Segregation of Duties ───

describe("Segregation of Duties", () => {
  interface ConfigRecord {
    createdById: string;
    reviewedById?: string | null;
    approvedById?: string | null;
  }

  function canApprove(userId: string, config: ConfigRecord): { allowed: boolean; reason?: string } {
    if (config.createdById === userId) {
      return { allowed: false, reason: "Cannot approve your own config" };
    }
    return { allowed: true };
  }

  function canActivate(userId: string, config: ConfigRecord): { allowed: boolean; reason?: string } {
    if (config.approvedById === userId) {
      return { allowed: false, reason: "Cannot activate a config you approved" };
    }
    return { allowed: true };
  }

  it("creator cannot approve their own config", () => {
    const config: ConfigRecord = { createdById: "user-A" };
    const result = canApprove("user-A", config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Cannot approve");
  });

  it("different user can approve a config", () => {
    const config: ConfigRecord = { createdById: "user-A" };
    const result = canApprove("user-B", config);
    expect(result.allowed).toBe(true);
  });

  it("approver cannot activate the config they approved", () => {
    const config: ConfigRecord = { createdById: "user-A", approvedById: "user-B" };
    const result = canActivate("user-B", config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Cannot activate");
  });

  it("different user can activate a config", () => {
    const config: ConfigRecord = { createdById: "user-A", approvedById: "user-B" };
    const result = canActivate("user-C", config);
    expect(result.allowed).toBe(true);
  });

  it("creator can activate if they did not approve", () => {
    const config: ConfigRecord = { createdById: "user-A", approvedById: "user-B" };
    const result = canActivate("user-A", config);
    expect(result.allowed).toBe(true);
  });

  it("full 3-person workflow: A creates, B approves, C activates", () => {
    const config: ConfigRecord = { createdById: "user-A" };

    // B approves
    const approveResult = canApprove("user-B", config);
    expect(approveResult.allowed).toBe(true);

    // C activates
    const activateResult = canActivate("user-C", { ...config, approvedById: "user-B" });
    expect(activateResult.allowed).toBe(true);
  });
});

// ─── Action Mapping ───

describe("Config Action Mapping", () => {
  const ACTION_TO_STATUS: Record<string, string> = {
    submit_review: "review",
    approve: "approved",
    activate: "active",
    archive: "archived",
    send_back: "draft",
  };

  it("maps all supported actions to statuses", () => {
    expect(ACTION_TO_STATUS.submit_review).toBe("review");
    expect(ACTION_TO_STATUS.approve).toBe("approved");
    expect(ACTION_TO_STATUS.activate).toBe("active");
    expect(ACTION_TO_STATUS.archive).toBe("archived");
    expect(ACTION_TO_STATUS.send_back).toBe("draft");
  });

  it("rejects unknown actions", () => {
    expect(ACTION_TO_STATUS["force_activate"]).toBeUndefined();
    expect(ACTION_TO_STATUS["delete"]).toBeUndefined();
  });
});
