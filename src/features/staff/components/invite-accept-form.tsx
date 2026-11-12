"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { acceptInviteSchema } from "@/features/staff/schemas";

export interface InviteAcceptFormProps {
  token: string;
  organizationName: string;
  roleName: string;
  initialName: string;
  maskedEmail: string;
}

export function InviteAcceptForm({
  token,
  organizationName,
  roleName,
  initialName,
  maskedEmail,
}: InviteAcceptFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const parsed = acceptInviteSchema.safeParse({ name, password });
    if (!parsed.success) {
      const errs = parsed.error.flatten().fieldErrors;
      setErrorMessage(
        errs.password?.[0] ?? errs.name?.[0] ?? "Please check your inputs.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/auth/invites/${encodeURIComponent(token)}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );

      const json = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setErrorMessage(json.error?.message ?? "Unable to accept invitation.");
        return;
      }

      router.push("/login?verified=1");
      router.refresh();
    } catch {
      setErrorMessage("Network error while accepting invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="rounded-control border border-subtle bg-muted px-4 py-3 text-sm text-ink-secondary">
        Invited to <span className="font-semibold text-ink">{organizationName}</span> as{" "}
        <span className="font-semibold text-ink">{roleName}</span> ({maskedEmail}).
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-control bg-status-cancelled-bg px-4 py-3 text-sm font-medium text-status-cancelled-fg"
        >
          {errorMessage}
        </div>
      ) : null}

      <Input
        label="Your Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />

      <Input
        label="Set Password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Minimum 8 characters"
        required
      />

      <Button type="submit" fullWidth loading={submitting}>
        Accept Invitation &amp; Activate Access
      </Button>
    </form>
  );
}
