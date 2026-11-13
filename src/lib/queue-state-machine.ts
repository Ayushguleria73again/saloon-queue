import type { TokenStatus } from "@prisma/client";
import { ConflictError, ForbiddenError } from "./errors";

export type QueueAction =
  "CALL_NEXT" | "START_SERVICE" | "COMPLETE" | "SKIP" | "CANCEL" | "MARK_NO_SHOW";

export type TransitionActorType = "OWNER" | "STAFF" | "CUSTOMER";

export const ACTION_TO_TARGET_STATUS: Record<QueueAction, TokenStatus> = {
  CALL_NEXT: "CALLED",
  START_SERVICE: "IN_SERVICE",
  COMPLETE: "COMPLETED",
  SKIP: "SKIPPED",
  CANCEL: "CANCELLED",
  MARK_NO_SHOW: "NO_SHOW",
};

export const ALLOWED_STATUS_TRANSITIONS: Record<TokenStatus, readonly TokenStatus[]> = {
  WAITING: ["CALLED", "IN_SERVICE", "CANCELLED"],
  CALLED: ["IN_SERVICE", "SKIPPED", "CANCELLED", "NO_SHOW"],
  IN_SERVICE: ["COMPLETED", "CANCELLED"],
  SKIPPED: ["NO_SHOW", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export interface TransitionValidationInput {
  currentStatus: TokenStatus;
  action: QueueAction;
  actorType: TransitionActorType;
  allowCustomerCancel?: boolean;
}

export interface TransitionValidationResult {
  fromStatus: TokenStatus;
  toStatus: TokenStatus;
}

/**
 * Pure state-transition validator enforcing `QUEUE_STATUS_TRANSITIONS.md` (`UT-STM-01..05`).
 * Rejects invalid jumps and enforces customer self-cancellation policy deterministically.
 */
export function validateTokenTransition(
  input: TransitionValidationInput,
): TransitionValidationResult {
  const { currentStatus, action, actorType, allowCustomerCancel = true } = input;
  const targetStatus = ACTION_TO_TARGET_STATUS[action];

  if (actorType === "CUSTOMER") {
    if (action !== "CANCEL") {
      throw new ForbiddenError(
        "FORBIDDEN",
        "Customers may only cancel their own waiting token.",
      );
    }

    if (currentStatus !== "WAITING") {
      throw new ConflictError(
        "SELF_CANCEL_NOT_ALLOWED",
        "Tokens can only be cancelled online while still waiting in the queue.",
      );
    }

    if (!allowCustomerCancel) {
      throw new ForbiddenError(
        "FORBIDDEN",
        "Online token cancellation is disabled for this branch.",
      );
    }

    return { fromStatus: currentStatus, toStatus: "CANCELLED" };
  }

  const allowedTargets = ALLOWED_STATUS_TRANSITIONS[currentStatus];
  if (!allowedTargets.includes(targetStatus)) {
    throw new ConflictError(
      "INVALID_STATE_TRANSITION",
      `Cannot perform ${action} on a token currently in ${currentStatus} status.`,
    );
  }

  return { fromStatus: currentStatus, toStatus: targetStatus };
}

export interface TokenTransitionTimestampUpdate {
  calledAt?: Date;
  serviceStartedAt?: Date;
  completedAt?: Date;
  skippedAt?: Date;
  cancelledAt?: Date;
  noShowAt?: Date;
}

/**
 * Computes timestamp updates for a validated status transition without overwriting
 * existing `calledAt` if already set cleanly.
 */
export function buildTransitionTimestamps(params: {
  targetStatus: TokenStatus;
  existingCalledAt: Date | null;
  now: Date;
}): TokenTransitionTimestampUpdate {
  const { targetStatus, existingCalledAt, now } = params;

  switch (targetStatus) {
    case "CALLED":
      return { calledAt: existingCalledAt ?? now };
    case "IN_SERVICE":
      return {
        calledAt: existingCalledAt ?? now,
        serviceStartedAt: now,
      };
    case "COMPLETED":
      return { completedAt: now };
    case "SKIPPED":
      return { skippedAt: now };
    case "CANCELLED":
      return { cancelledAt: now };
    case "NO_SHOW":
      return { noShowAt: now };
    case "WAITING":
      return {};
  }
}
