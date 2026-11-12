"use client";

import { useState } from "react";
import { Copy, UserPlus } from "lucide-react";
import { Button, ConfirmModal, Input, useToast } from "@/components/ui";
import { inviteStaffSchema } from "@/features/staff/schemas";

export interface StaffMemberView {
  id: string;
  userId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REVOKED";
  allBranches: boolean;
  role: { id: string; name: string; slug: string };
  branches: Array<{ id: string; name: string }>;
}

export interface RoleView {
  id: string;
  name: string;
  slug: string;
}

export interface BranchRefView {
  id: string;
  name: string;
}

export function StaffManager({
  currentUserId,
  initialMembers,
  roles,
  branches,
}: {
  currentUserId: string;
  initialMembers: StaffMemberView[];
  roles: RoleView[];
  branches: BranchRefView[];
}) {
  const { showToast } = useToast();
  const [members, setMembers] = useState<StaffMemberView[]>(initialMembers);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(
    roles.find((r) => r.slug === "STAFF")?.id ?? roles[0]?.id ?? "",
  );
  const [allBranches, setAllBranches] = useState(false);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>(
    branches[0]?.id ? [branches[0].id] : [],
  );
  const [inviting, setInviting] = useState(false);
  const [latestInvitePath, setLatestInvitePath] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<StaffMemberView | null>(null);
  const [revoking, setRevoking] = useState(false);

  function toggleBranchSelection(branchId: string) {
    setSelectedBranchIds((prev) =>
      prev.includes(branchId)
        ? prev.filter((id) => id !== branchId)
        : [...prev, branchId],
    );
  }

  async function refreshMembers() {
    const res = await fetch("/api/owner/staff");
    if (res.ok) {
      const json = (await res.json()) as { members: StaffMemberView[] };
      setMembers(json.members);
    }
  }

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = inviteStaffSchema.safeParse({
      name,
      email,
      roleId,
      allBranches,
      branchIds: allBranches ? [] : selectedBranchIds,
    });

    if (!parsed.success) {
      showToast({
        variant: "error",
        title: "Invalid invitation",
        description:
          parsed.error.issues[0]?.message ?? "Check name, email, role, and branches.",
      });
      return;
    }

    setInviting(true);
    try {
      const response = await fetch("/api/owner/staff/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const json = (await response.json()) as {
        invite?: { invitePath: string };
        error?: { message?: string };
      };

      if (!response.ok || !json.invite) {
        showToast({
          variant: "error",
          title: "Invitation failed",
          description: json.error?.message,
        });
        return;
      }

      setLatestInvitePath(json.invite.invitePath);
      setName("");
      setEmail("");
      await refreshMembers();
      showToast({ variant: "success", title: "Staff invitation created" });
    } finally {
      setInviting(false);
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/owner/staff/${revokeTarget.id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        showToast({
          variant: "error",
          title: "Revocation failed",
          description: json.error?.message,
        });
        return;
      }

      setRevokeTarget(null);
      await refreshMembers();
      showToast({ variant: "success", title: "Staff access revoked immediately" });
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Staff &amp; Roles</h1>
        <p className="text-sm text-ink-secondary">
          Invite team members, assign RBAC roles, and scope access to specific branches.
        </p>
      </div>

      <form
        onSubmit={handleInvite}
        className="space-y-4 rounded-card border border-subtle bg-surface p-5 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-brand-accent" aria-hidden="true" />
          <h2 className="text-base font-semibold text-ink">Invite Team Member</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Full Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Suresh Reddy"
            required
          />
          <Input
            label="Work Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="suresh@salon.in"
            required
          />
          <div className="space-y-1.5">
            <label htmlFor="staff-role" className="block text-sm font-medium text-ink">
              Role
            </label>
            <select
              id="staff-role"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="min-h-12 w-full rounded-control border border-subtle bg-surface px-3 text-base text-ink focus:border-brand-primary focus:outline-none"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={allBranches}
              onChange={(e) => setAllBranches(e.target.checked)}
            />
            <span>Grant access to all current and future branches</span>
          </label>

          {!allBranches ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {branches.map((branch) => {
                const checked = selectedBranchIds.includes(branch.id);
                return (
                  <label
                    key={branch.id}
                    className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-subtle bg-canvas px-3 py-1.5 text-sm text-ink"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleBranchSelection(branch.id)}
                    />
                    <span>{branch.name}</span>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>

        <Button type="submit" loading={inviting}>
          Send 48-Hour Invite
        </Button>

        {latestInvitePath ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-subtle bg-muted px-3.5 py-2.5 text-xs text-ink">
            <span className="break-all font-mono">{latestInvitePath}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(
                  `${window.location.origin}${latestInvitePath}`,
                );
                showToast({ variant: "info", title: "Invite URL copied" });
              }}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Copy Link</span>
            </Button>
          </div>
        ) : null}
      </form>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Organization Members</h2>
        <div className="space-y-3">
          {members.map((member) => {
            const isSelf = member.userId === currentUserId;
            return (
              <div
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-subtle bg-surface p-4 shadow-sm"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{member.name}</span>
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-ink">
                      {member.role.name}
                    </span>
                    <span className="rounded-full bg-status-called-bg px-2.5 py-0.5 text-xs font-semibold text-status-called-fg">
                      {member.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-secondary">{member.email}</p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    Branches:{" "}
                    {member.allBranches
                      ? "All branches"
                      : member.branches.map((b) => b.name).join(", ") || "None"}
                  </p>
                </div>

                {!isSelf && member.status !== "REVOKED" ? (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setRevokeTarget(member)}
                  >
                    Revoke Access
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <ConfirmModal
        open={Boolean(revokeTarget)}
        title="Revoke Staff Access?"
        description={
          revokeTarget
            ? `${revokeTarget.name} will be signed out immediately and stop receiving branch push alerts.`
            : ""
        }
        confirmLabel="Revoke Member"
        tone="danger"
        loading={revoking}
        onConfirm={handleConfirmRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
