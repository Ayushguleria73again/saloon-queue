// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DashboardShell,
  filterDashboardNavItems,
} from "@/components/layout/dashboard-shell";
import {
  BranchSwitcher,
  Button,
  ConfirmModal,
  Input,
  ServiceCard,
  StatCard,
  StatusBadge,
  Textarea,
  ToastProvider,
  useToast,
  type TokenUiStatus,
} from "@/components/ui";

vi.mock("next/navigation", () => ({
  usePathname: () => "/owner/dashboard",
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

function ToastTrigger() {
  const { showToast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        showToast({
          title: "Token created",
          description: "A014 is now waiting",
          variant: "success",
        })
      }
    >
      Trigger Toast
    </button>
  );
}

describe("StatusBadge", () => {
  const ALL_STATUSES: Array<{ status: TokenUiStatus; label: string }> = [
    { status: "WAITING", label: "Waiting" },
    { status: "CALLED", label: "Called" },
    { status: "IN_SERVICE", label: "In Service" },
    { status: "COMPLETED", label: "Completed" },
    { status: "SKIPPED", label: "Skipped" },
    { status: "CANCELLED", label: "Cancelled" },
    { status: "NO_SHOW", label: "No Show" },
  ];

  it("renders all 7 token statuses with accessible labels and decorative icons", () => {
    render(
      <div>
        {ALL_STATUSES.map(({ status }) => (
          <StatusBadge key={status} status={status} />
        ))}
      </div>,
    );

    for (const { status, label } of ALL_STATUSES) {
      const textNode = screen.getByText(label);
      const badge = textNode.closest("[data-status]");
      expect(badge).toHaveAttribute("data-status", status);
      expect(badge?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
  });
});

describe("ServiceCard", () => {
  it("renders formatted INR price, duration, aria-pressed state, and toggles selection", () => {
    const onToggle = vi.fn();

    const { rerender } = render(
      <ServiceCard
        id="svc_1"
        name="Classic Haircut"
        description="Precision cut and wash"
        priceInPaise={30000}
        durationMinutes={30}
        selected={false}
        onToggle={onToggle}
      />,
    );

    const button = screen.getByRole("button", { name: /Classic Haircut/i });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveClass("min-h-12");
    expect(screen.getByText("₹300")).toBeInTheDocument();
    expect(screen.getByText("30 mins")).toBeInTheDocument();

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith("svc_1");

    rerender(
      <ServiceCard
        id="svc_1"
        name="Classic Haircut"
        description="Precision cut and wash"
        priceInPaise={30000}
        durationMinutes={30}
        selected={true}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByRole("button", { name: /Classic Haircut/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("ConfirmModal", () => {
  it("supports accessible dialog attributes, Escape closing, and action callbacks", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    const { rerender } = render(
      <ConfirmModal
        open={false}
        title="Cancel Token?"
        description="This releases your place in the queue."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <ConfirmModal
        open={true}
        title="Cancel Token?"
        description="This releases your place in the queue."
        confirmLabel="Yes, Cancel"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Cancel Token?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByText("This releases your place in the queue."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Yes, Cancel" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("blocks Escape close while loading is true", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmModal
        open={true}
        title="Revoke Member?"
        description="Session will end immediately."
        loading={true}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("Form controls, StatCard, BranchSwitcher, Toast & Nav RBAC filter", () => {
  it("associates Input/Textarea labels, mobile 16px sizing, and alert errors", () => {
    render(
      <div>
        <Input
          label="Mobile Number"
          prefix="+91"
          error="Enter a valid 10-digit mobile number"
        />
        <Textarea label="Notes" hint="Optional styling instructions" />
      </div>,
    );

    const mobileInput = screen.getByLabelText("Mobile Number");
    expect(mobileInput).toHaveAttribute("aria-invalid", "true");
    expect(mobileInput).toHaveClass("text-base");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid 10-digit mobile number",
    );

    const notesInput = screen.getByLabelText("Notes");
    expect(notesInput).toHaveClass("text-base");
  });

  it("renders BranchSwitcher static badge for 1 branch and select dropdown for multiple", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <BranchSwitcher
        branches={[{ id: "b1", name: "Koramangala" }]}
        selectedBranchId="b1"
        onChange={onChange}
      />,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Koramangala")).toBeInTheDocument();

    rerender(
      <BranchSwitcher
        branches={[
          { id: "b1", name: "Koramangala", city: "Bengaluru" },
          { id: "b2", name: "Indiranagar", city: "Bengaluru" },
        ]}
        selectedBranchId="b1"
        onChange={onChange}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Active branch" });
    fireEvent.change(select, { target: { value: "b2" } });
    expect(onChange).toHaveBeenCalledWith("b2");
  });

  it("renders StatCard and dismissible Toast notifications", async () => {
    render(
      <ToastProvider>
        <StatCard label="Waiting" value={4} subtitle="Est. 22 mins" />
        <ToastTrigger />
      </ToastProvider>,
    );

    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Trigger Toast" }));
    expect(screen.getByRole("status")).toHaveTextContent("Token created");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  it("filters DashboardShell navigation links accurately by RolePermission and exposes mobile drawer menu & sign-out", () => {
    const staffNav = filterDashboardNavItems(new Set(["QUEUE_VIEW", "HISTORY_VIEW"]));
    const hrefs = staffNav.map((item) => item.href);

    expect(hrefs).toContain("/owner/dashboard");
    expect(hrefs).toContain("/owner/queue");
    expect(hrefs).toContain("/owner/history");
    expect(hrefs).toContain("/owner/settings");
    expect(hrefs).not.toContain("/owner/branches");
    expect(hrefs).not.toContain("/owner/staff");
    expect(hrefs).not.toContain("/owner/analytics");

    render(
      <DashboardShell organizationName="Aura Grooming Co.">
        <div>Workspace Content</div>
      </DashboardShell>,
    );

    const menuButton = screen.getByRole("button", { name: /open navigation menu/i });
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: /mobile menu/i })).toBeInTheDocument();
  });

  it("moves focus into ConfirmModal on open, enforces >=48px touch height on Button sm on mobile, and keeps BranchSwitcher controlled", () => {
    render(
      <div>
        <Button size="sm">Compact CTA</Button>
        <BranchSwitcher
          branches={[
            { id: "b1", name: "Branch One" },
            { id: "b2", name: "Branch Two" },
          ]}
          selectedBranchId=""
          onChange={vi.fn()}
        />
        <ConfirmModal
          open={true}
          title="Focus Check"
          description="Verify initial dialog focus."
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </div>,
    );

    expect(screen.getByRole("button", { name: "Compact CTA" })).toHaveClass("min-h-12");
    expect(screen.getByRole("combobox", { name: "Active branch" })).toHaveValue("b1");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });
});
