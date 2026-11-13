export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "BRANCH_ACCESS_DENIED"
  | "TENANT_SUSPENDED"
  | "QR_TOKEN_INVALID"
  | "BRANCH_NOT_ACCEPTING"
  | "RESOURCE_NOT_FOUND"
  | "ACTIVE_TOKEN_EXISTS"
  | "INVALID_STATE_TRANSITION"
  | "SELF_CANCEL_NOT_ALLOWED"
  | "NO_WAITING_CUSTOMERS"
  | "SLUG_TAKEN"
  | "TOKEN_CLOSED"
  | "SERVICE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown> | null;
    requestId: string;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: Record<string, unknown> | null;

  constructor(params: {
    code: ErrorCode;
    statusCode: number;
    message: string;
    details?: Record<string, unknown> | null;
  }) {
    super(params.message);
    this.name = "AppError";
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.details = params.details ?? null;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Please review the highlighted fields.", fieldErrors?: unknown) {
    super({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      message,
      details: fieldErrors ? { fieldErrors } : null,
    });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required.") {
    super({ code: "UNAUTHORIZED", statusCode: 401, message });
  }
}

export class ForbiddenError extends AppError {
  constructor(
    code:
      | "FORBIDDEN"
      | "BRANCH_ACCESS_DENIED"
      | "TENANT_SUSPENDED"
      | "QR_TOKEN_INVALID"
      | "BRANCH_NOT_ACCEPTING" = "FORBIDDEN",
    message = "You do not have permission to perform this action.",
  ) {
    super({ code, statusCode: 403, message });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Requested resource was not found.") {
    super({ code: "RESOURCE_NOT_FOUND", statusCode: 404, message });
  }
}

export class ConflictError extends AppError {
  constructor(
    code:
      | "ACTIVE_TOKEN_EXISTS"
      | "INVALID_STATE_TRANSITION"
      | "SELF_CANCEL_NOT_ALLOWED"
      | "NO_WAITING_CUSTOMERS"
      | "SLUG_TAKEN"
      | "TOKEN_CLOSED",
    message: string,
  ) {
    super({ code, statusCode: 409, message });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
    message = "One or more selected services are unavailable at this branch.",
    details?: Record<string, unknown> | null,
  ) {
    super({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 422,
      message,
      details,
    });
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(
    retryAfterSeconds: number,
    message = "Too many requests. Please try again shortly.",
  ) {
    super({
      code: "RATE_LIMITED",
      statusCode: 429,
      message,
      details: { retryAfterSeconds },
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function mapErrorToEnvelope(
  error: unknown,
  requestId: string,
): { statusCode: number; body: ErrorEnvelope; headers?: Record<string, string> } {
  if (error instanceof AppError) {
    const headers =
      error instanceof RateLimitError
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : undefined;

    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId,
        },
      },
      headers,
    };
  }

  return {
    statusCode: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        details: null,
        requestId,
      },
    },
  };
}
