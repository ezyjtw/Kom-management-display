/**
 * API response helper tests.
 */
import { describe, it, expect } from "vitest";
import {
  apiSuccess,
  apiPaginated,
  apiValidationError,
  apiAuthError,
  apiForbiddenError,
  apiNotFoundError,
  handleApiError,
} from "@/lib/api/response";

describe("API Response Helpers", () => {
  it("apiSuccess returns correct structure", async () => {
    const response = apiSuccess({ id: 1, name: "Test" });
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: 1, name: "Test" });
    expect(body.requestId).toBeDefined();
    expect(response.status).toBe(200);
  });

  it("apiSuccess with custom status", async () => {
    const response = apiSuccess({ created: true }, undefined, 201);
    expect(response.status).toBe(201);
  });

  it("apiPaginated returns pagination metadata", async () => {
    const items = [{ id: 1 }, { id: 2 }];
    const response = apiPaginated(items, { page: 1, pageSize: 10, total: 25 });
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.pageSize).toBe(10);
    expect(body.pagination.total).toBe(25);
    expect(body.pagination.totalPages).toBe(3);
  });

  it("apiValidationError returns 400", async () => {
    const response = apiValidationError("Field X is required");
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Field X is required");
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("apiAuthError returns 401", async () => {
    const response = apiAuthError();
    expect(response.status).toBe(401);
  });

  it("apiForbiddenError returns 403", async () => {
    const response = apiForbiddenError();
    expect(response.status).toBe(403);
  });

  it("apiNotFoundError returns 404 with resource name", async () => {
    const response = apiNotFoundError("Employee");
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error).toBe("Employee not found");
  });

  it("handleApiError maps Prisma unique constraint to 409", async () => {
    const error = new Error("Unique constraint failed on the fields: (`email`)");
    const response = handleApiError(error);
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toContain("already exists");
  });

  it("handleApiError maps not found to 404", async () => {
    const error = new Error("Record to update not found");
    const response = handleApiError(error);
    expect(response.status).toBe(404);
  });

  it("handleApiError returns 500 for unknown errors", async () => {
    const error = new Error("Something unexpected");
    const response = handleApiError(error);
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toBe("An internal error occurred");
    // Should NOT expose internal error message
    expect(body.error).not.toContain("unexpected");
  });
});
