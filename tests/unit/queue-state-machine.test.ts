import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import {
  buildTransitionTimestamps,
  validateTokenTransition,
} from "@/lib/queue-state-machine";
import {
  branchHistoryQuerySchema,
  transitionTokenStatusSchema,
  walkInTokenSchema,
} from "@/features/queue/schemas";

describe("Phase 8 Queue State Machine & Schemas (UT-STM-01..05)", () => {
  it("UT-STM-01: allows WAITING -> CALLED | IN_SERVICE | CANCELLED and rejects invalid targets", () => {
    expect(
      validateTokenTransition({
        currentStatus: "WAITING",
        action: "CALL_NEXT",
        actorType: "STAFF",
      }),
    ).toEqual({ fromStatus: "WAITING", toStatus: "CALLED" });

    expect(
      validateTokenTransition({
        currentStatus: "WAITING",
        action: "START_SERVICE",
        actorType: "OWNER",
      }),
    ).toEqual({ fromStatus: "WAITING", toStatus: "IN_SERVICE" });

    expect(
      validateTokenTransition({
        currentStatus: "WAITING",
        action: "CANCEL",
        actorType: "STAFF",
      }),
    ).toEqual({ fromStatus: "WAITING", toStatus: "CANCELLED" });

    for (const badAction of ["COMPLETE", "SKIP", "MARK_NO_SHOW"] as const) {
      expect(() =>
        validateTokenTransition({
          currentStatus: "WAITING",
          action: badAction,
          actorType: "STAFF",
        }),
      ).toThrow(ConflictError);
    }
  });

  it("UT-STM-02: allows CALLED -> IN_SERVICE | SKIPPED | CANCELLED | NO_SHOW and rejects COMPLETE", () => {
    expect(
      validateTokenTransition({
        currentStatus: "CALLED",
        action: "START_SERVICE",
        actorType: "STAFF",
      }).toStatus,
    ).toBe("IN_SERVICE");
    expect(
      validateTokenTransition({
        currentStatus: "CALLED",
        action: "SKIP",
        actorType: "STAFF",
      }).toStatus,
    ).toBe("SKIPPED");
    expect(
      validateTokenTransition({
        currentStatus: "CALLED",
        action: "CANCEL",
        actorType: "STAFF",
      }).toStatus,
    ).toBe("CANCELLED");
    expect(
      validateTokenTransition({
        currentStatus: "CALLED",
        action: "MARK_NO_SHOW",
        actorType: "STAFF",
      }).toStatus,
    ).toBe("NO_SHOW");

    expect(() =>
      validateTokenTransition({
        currentStatus: "CALLED",
        action: "COMPLETE",
        actorType: "STAFF",
      }),
    ).toThrow(ConflictError);
  });

  it("UT-STM-03: allows IN_SERVICE -> COMPLETED | CANCELLED and rejects backward transitions", () => {
    expect(
      validateTokenTransition({
        currentStatus: "IN_SERVICE",
        action: "COMPLETE",
        actorType: "STAFF",
      }).toStatus,
    ).toBe("COMPLETED");
    expect(
      validateTokenTransition({
        currentStatus: "IN_SERVICE",
        action: "CANCEL",
        actorType: "OWNER",
      }).toStatus,
    ).toBe("CANCELLED");

    for (const badAction of [
      "CALL_NEXT",
      "START_SERVICE",
      "SKIP",
      "MARK_NO_SHOW",
    ] as const) {
      expect(() =>
        validateTokenTransition({
          currentStatus: "IN_SERVICE",
          action: badAction,
          actorType: "STAFF",
        }),
      ).toThrow(ConflictError);
    }
  });

  it("UT-STM-04: allows SKIPPED -> NO_SHOW | CANCELLED and rejects transitions out of terminal states", () => {
    expect(
      validateTokenTransition({
        currentStatus: "SKIPPED",
        action: "MARK_NO_SHOW",
        actorType: "STAFF",
      }).toStatus,
    ).toBe("NO_SHOW");
    expect(
      validateTokenTransition({
        currentStatus: "SKIPPED",
        action: "CANCEL",
        actorType: "STAFF",
      }).toStatus,
    ).toBe("CANCELLED");

    expect(() =>
      validateTokenTransition({
        currentStatus: "SKIPPED",
        action: "START_SERVICE",
        actorType: "STAFF",
      }),
    ).toThrow(ConflictError);

    for (const terminal of ["COMPLETED", "CANCELLED", "NO_SHOW"] as const) {
      for (const action of [
        "CALL_NEXT",
        "START_SERVICE",
        "COMPLETE",
        "SKIP",
        "CANCEL",
        "MARK_NO_SHOW",
      ] as const) {
        expect(() =>
          validateTokenTransition({
            currentStatus: terminal,
            action,
            actorType: "OWNER",
          }),
        ).toThrow(ConflictError);
      }
    }
  });

  it("UT-STM-05: restricts customer self-cancellation strictly to WAITING when allowCustomerCancel is true", () => {
    expect(
      validateTokenTransition({
        currentStatus: "WAITING",
        action: "CANCEL",
        actorType: "CUSTOMER",
        allowCustomerCancel: true,
      }).toStatus,
    ).toBe("CANCELLED");

    expect(() =>
      validateTokenTransition({
        currentStatus: "WAITING",
        action: "CANCEL",
        actorType: "CUSTOMER",
        allowCustomerCancel: false,
      }),
    ).toThrow(ForbiddenError);

    for (const activeStatus of ["CALLED", "IN_SERVICE", "COMPLETED"] as const) {
      expect(() =>
        validateTokenTransition({
          currentStatus: activeStatus,
          action: "CANCEL",
          actorType: "CUSTOMER",
          allowCustomerCancel: true,
        }),
      ).toThrow(ConflictError);
    }

    expect(() =>
      validateTokenTransition({
        currentStatus: "WAITING",
        action: "START_SERVICE",
        actorType: "CUSTOMER",
        allowCustomerCancel: true,
      }),
    ).toThrow(ForbiddenError);
  });

  it("populates calledAt automatically on direct WAITING -> IN_SERVICE shortcut", () => {
    const now = new Date("2026-11-12T10:00:00.000Z");
    const timestamps = buildTransitionTimestamps({
      targetStatus: "IN_SERVICE",
      existingCalledAt: null,
      now,
    });
    expect(timestamps).toEqual({ calledAt: now, serviceStartedAt: now });

    const priorCalledAt = new Date("2026-11-12T09:55:00.000Z");
    expect(
      buildTransitionTimestamps({
        targetStatus: "IN_SERVICE",
        existingCalledAt: priorCalledAt,
        now,
      }),
    ).toEqual({ calledAt: priorCalledAt, serviceStartedAt: now });
  });

  it("validates walk-in, transition, and bounded history schemas cleanly", () => {
    const svcId = "550e8400-e29b-41d4-a716-446655440000";
    const walkIn = walkInTokenSchema.parse({
      fullName: "Ananya Roy",
      mobileNumber: "+91 98765 00112",
      serviceIds: [svcId],
    });
    expect(walkIn.mobileNumber).toBe("9876500112");

    expect(transitionTokenStatusSchema.parse({ action: "START_SERVICE" }).action).toBe(
      "START_SERVICE",
    );

    expect(branchHistoryQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(branchHistoryQuerySchema.parse({ status: "COMPLETED", limit: "20" })).toEqual({
      status: "COMPLETED",
      limit: 20,
    });
  });
});
