import { describe, expect, it } from "vitest";
import {
  adminJobQuerySchema,
  adminTenantQuerySchema,
  updateTenantStatusSchema,
} from "@/features/admin/schemas";

describe("Phase 15: Platform Administration Zod Schemas", () => {
  it("validates adminTenantQuerySchema with defaults and pagination bounds", () => {
    const defaultQuery = adminTenantQuerySchema.safeParse({});
    expect(defaultQuery.success).toBe(true);
    if (!defaultQuery.success) return;
    expect(defaultQuery.data.status).toBe("ALL");
    expect(defaultQuery.data.page).toBe(1);
    expect(defaultQuery.data.limit).toBe(20);

    const customQuery = adminTenantQuerySchema.safeParse({
      status: "SUSPENDED",
      q: "Aura",
      page: "2",
      limit: "50",
    });
    expect(customQuery.success).toBe(true);
    if (!customQuery.success) return;
    expect(customQuery.data.status).toBe("SUSPENDED");
    expect(customQuery.data.q).toBe("Aura");
    expect(customQuery.data.page).toBe(2);
    expect(customQuery.data.limit).toBe(50);

    const exceedLimit = adminTenantQuerySchema.safeParse({ limit: 100 });
    expect(exceedLimit.success).toBe(false);
  });

  it("validates updateTenantStatusSchema and enforces minimum reason length", () => {
    const valid = updateTenantStatusSchema.safeParse({
      status: "SUSPENDED",
      reason: "Abusive volume detected.",
    });
    expect(valid.success).toBe(true);

    const shortReason = updateTenantStatusSchema.safeParse({
      status: "SUSPENDED",
      reason: "No",
    });
    expect(shortReason.success).toBe(false);

    const invalidStatus = updateTenantStatusSchema.safeParse({
      status: "UNKNOWN_STATUS",
      reason: "Some valid reason",
    });
    expect(invalidStatus.success).toBe(false);
  });

  it("validates adminJobQuerySchema with status filters and search terms", () => {
    const valid = adminJobQuerySchema.safeParse({
      status: "DEAD_LETTER",
      q: "TOKEN_CALLED",
      page: 1,
      limit: 25,
    });
    expect(valid.success).toBe(true);
    if (!valid.success) return;
    expect(valid.data.status).toBe("DEAD_LETTER");
    expect(valid.data.q).toBe("TOKEN_CALLED");
  });
});

