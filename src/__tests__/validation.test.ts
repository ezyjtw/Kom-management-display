import { describe, it, expect } from "vitest";
import {
  validateBody,
  createScoreSchema,
  createEmployeeSchema,
  createUserSchema,
  createIncidentSchema,
  createScreeningSchema,
  createTravelRuleCaseSchema,
  updateBrandingSchema,
} from "@/lib/validation";

describe("validateBody", () => {
  it("returns parsed data on valid input", () => {
    const result = validateBody(createScoreSchema, {
      employeeId: "emp-1",
      periodId: "period-1",
      category: "daily_tasks",
      rawIndex: 0.75,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.employeeId).toBe("emp-1");
      expect(result.data.rawIndex).toBe(0.75);
    }
  });

  it("returns error on missing required fields", () => {
    const result = validateBody(createScoreSchema, {
      employeeId: "emp-1",
      // missing periodId, category, rawIndex
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("periodId");
    }
  });

  it("returns error on invalid enum value", () => {
    const result = validateBody(createScoreSchema, {
      employeeId: "emp-1",
      periodId: "period-1",
      category: "invalid_category",
      rawIndex: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it("returns error when rawIndex out of range", () => {
    const result = validateBody(createScoreSchema, {
      employeeId: "emp-1",
      periodId: "period-1",
      category: "daily_tasks",
      rawIndex: 1.5, // max is 1
    });
    expect(result.success).toBe(false);
  });
});

describe("createEmployeeSchema", () => {
  it("validates a correct employee", () => {
    const result = validateBody(createEmployeeSchema, {
      name: "John Doe",
      email: "john@example.com",
      role: "Analyst",
      team: "Transaction Operations",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = validateBody(createEmployeeSchema, {
      name: "John",
      email: "not-an-email",
      role: "Analyst",
      team: "Ops",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = validateBody(createEmployeeSchema, {
      name: "",
      email: "john@example.com",
      role: "Analyst",
      team: "Ops",
    });
    expect(result.success).toBe(false);
  });
});

describe("createUserSchema", () => {
  it("rejects password shorter than 8 characters", () => {
    const result = validateBody(createUserSchema, {
      email: "user@example.com",
      name: "User",
      role: "employee",
      password: "short",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("password");
    }
  });

  it("rejects invalid role", () => {
    const result = validateBody(createUserSchema, {
      email: "user@example.com",
      name: "User",
      role: "superadmin",
      password: "longenoughpassword",
    });
    expect(result.success).toBe(false);
  });
});

describe("createIncidentSchema", () => {
  it("applies defaults for optional fields", () => {
    const result = validateBody(createIncidentSchema, {
      title: "Fireblocks down",
      provider: "Fireblocks",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.severity).toBe("medium");
      expect(result.data.description).toBe("");
    }
  });
});

describe("createScreeningSchema", () => {
  it("validates a screening entry", () => {
    const result = validateBody(createScreeningSchema, {
      transactionId: "tx-123",
      asset: "ETH",
      amount: 1.5,
      direction: "IN",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid direction", () => {
    const result = validateBody(createScreeningSchema, {
      transactionId: "tx-123",
      asset: "ETH",
      direction: "SIDEWAYS",
    });
    expect(result.success).toBe(false);
  });
});

describe("createTravelRuleCaseSchema", () => {
  it("validates a travel rule case", () => {
    const result = validateBody(createTravelRuleCaseSchema, {
      transactionId: "tx-456",
      direction: "OUT",
      asset: "BTC",
      amount: 0.5,
      matchStatus: "unmatched",
    });
    expect(result.success).toBe(true);
  });
});

describe("updateBrandingSchema", () => {
  it("allows partial updates", () => {
    const result = validateBody(updateBrandingSchema, {
      appName: "New Name",
    });
    expect(result.success).toBe(true);
  });

  it("rejects logo data that's too large", () => {
    const result = validateBody(updateBrandingSchema, {
      logoData: "x".repeat(800_000),
    });
    expect(result.success).toBe(false);
  });
});
