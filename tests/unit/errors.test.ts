import { describe, expect, it } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
  mapErrorToEnvelope,
} from "@/lib/errors";

describe("mapErrorToEnvelope", () => {
  it("maps AppError subclasses to standard envelope", () => {
    const err = new ValidationError("Invalid form", {
      mobileNumber: ["Must be 10 digits"],
    });
    const mapped = mapErrorToEnvelope(err, "req_123");

    expect(mapped.statusCode).toBe(400);
    expect(mapped.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid form",
        details: { fieldErrors: { mobileNumber: ["Must be 10 digits"] } },
        requestId: "req_123",
      },
    });
  });

  it("adds Retry-After header for RateLimitError", () => {
    const err = new RateLimitError(45);
    const mapped = mapErrorToEnvelope(err, "req_456");

    expect(mapped.statusCode).toBe(429);
    expect(mapped.headers).toEqual({ "Retry-After": "45" });
    expect(mapped.body.error.code).toBe("RATE_LIMITED");
  });

  it("sanitizes unknown errors to 500 without leaking internal stack or message", () => {
    const mapped = mapErrorToEnvelope(
      new Error("ECONNREFUSED postgres://admin:supersecret@db:5432"),
      "req_789",
    );

    expect(mapped.statusCode).toBe(500);
    expect(mapped.body.error.code).toBe("INTERNAL_ERROR");
    expect(mapped.body.error.message).toBe("An unexpected error occurred.");
    expect(JSON.stringify(mapped.body)).not.toContain("supersecret");
  });

  it("maps tenant, service-unavailable (422), and conflict codes cleanly", () => {
    const forbidden = new ForbiddenError("BRANCH_ACCESS_DENIED", "No branch access");
    const conflict = new ConflictError("ACTIVE_TOKEN_EXISTS", "Active token exists");
    const unavailable = new ServiceUnavailableError();

    expect(mapErrorToEnvelope(forbidden, "req_1").statusCode).toBe(403);
    expect(mapErrorToEnvelope(conflict, "req_2").statusCode).toBe(409);

    const mappedUnavailable = mapErrorToEnvelope(unavailable, "req_3");
    expect(mappedUnavailable.statusCode).toBe(422);
    expect(mappedUnavailable.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
