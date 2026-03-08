/**
 * Standardized API response helpers.
 *
 * Every API route should use these instead of raw NextResponse.json().
 * This ensures consistent response shapes, error handling, and correlation IDs.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { logger } from "@/lib/logger";

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: ResponseMeta;
  requestId: string;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
  requestId: string;
}

export interface ApiPaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  meta?: ResponseMeta;
  requestId: string;
}

export interface ResponseMeta {
  timestamp?: string;
  duration?: number;
  [key: string]: unknown;
}

/**
 * Generate a request correlation ID.
 */
export function generateRequestId(): string {
  return randomUUID().substring(0, 8);
}

/**
 * Return a successful response.
 */
export function apiSuccess<T>(data: T, meta?: ResponseMeta, status = 200): NextResponse {
  const response: ApiSuccessResponse<T> = {
    success: true,
    data,
    requestId: generateRequestId(),
  };
  if (meta) response.meta = meta;
  return NextResponse.json(response, { status });
}

/**
 * Return a paginated response.
 */
export function apiPaginated<T>(
  data: T[],
  pagination: { page: number; pageSize: number; total: number },
  meta?: ResponseMeta,
): NextResponse {
  const response: ApiPaginatedResponse<T> = {
    success: true,
    data,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.pageSize),
    },
    requestId: generateRequestId(),
  };
  if (meta) response.meta = meta;
  return NextResponse.json(response);
}

/**
 * Return a validation error (400).
 */
export function apiValidationError(message: string): NextResponse {
  return apiError(message, 400, "VALIDATION_ERROR");
}

/**
 * Return an authentication error (401).
 */
export function apiAuthError(message = "Authentication required"): NextResponse {
  return apiError(message, 401, "AUTH_REQUIRED");
}

/**
 * Return a forbidden error (403).
 */
export function apiForbiddenError(message = "Insufficient permissions"): NextResponse {
  return apiError(message, 403, "FORBIDDEN");
}

/**
 * Return a not found error (404).
 */
export function apiNotFoundError(resource = "Resource"): NextResponse {
  return apiError(`${resource} not found`, 404, "NOT_FOUND");
}

/**
 * Return a conflict error (409).
 */
export function apiConflictError(message: string): NextResponse {
  return apiError(message, 409, "CONFLICT");
}

/**
 * Return a generic error response.
 */
export function apiError(message: string, status = 500, code?: string): NextResponse {
  const response: ApiErrorResponse = {
    success: false,
    error: message,
    requestId: generateRequestId(),
  };
  if (code) response.code = code;
  return NextResponse.json(response, { status });
}

/**
 * Sanitize error for client response — never expose internals.
 * Logs full error server-side for debugging.
 */
export function handleApiError(error: unknown, context?: string): NextResponse {
  const requestId = generateRequestId();

  logger.error(`API error${context ? ` in ${context}` : ""}`, {
    requestId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  let message = "An internal error occurred";
  let status = 500;

  if (error instanceof Error) {
    if (error.message.includes("Unique constraint")) {
      message = "A record with this value already exists";
      status = 409;
    } else if (
      error.message.includes("Record to update not found") ||
      error.message.includes("Record to delete does not exist")
    ) {
      message = "Record not found";
      status = 404;
    } else if (error.message.includes("Foreign key constraint")) {
      message = "Referenced record does not exist";
      status = 400;
    } else if (
      error.message.includes("Invalid `") ||
      error.message.includes("Argument")
    ) {
      message = "Invalid request data";
      status = 400;
    }
  }

  return NextResponse.json(
    { success: false, error: message, requestId } as ApiErrorResponse,
    { status },
  );
}
