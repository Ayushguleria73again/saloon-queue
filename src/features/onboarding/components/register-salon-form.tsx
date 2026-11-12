"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { registerSalonSchema, toUrlSlug } from "@/features/onboarding/schemas";

interface RegisterResponse {
  organizationId: string;
  salonSlug: string;
  branchSlug: string;
  status: string;
  devVerificationPath?: string;
}

export function RegisterSalonForm() {
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [salonSlug, setSalonSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [branchName, setBranchName] = useState("Main Branch");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>(
    {},
  );
  const [registered, setRegistered] = useState<RegisterResponse | null>(null);

  function handleOrgNameChange(value: string) {
    setOrganizationName(value);
    if (!slugTouched) {
      setSalonSlug(toUrlSlug(value));
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setFieldErrors({});

    const parsed = registerSalonSchema.safeParse({
      ownerName,
      email,
      password,
      organizationName,
      salonSlug,
      branchName,
      branchSlug: "main",
      city: city || undefined,
      phone,
      timezone: "Asia/Kolkata",
      website,
    });

    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors);
      setErrorMessage("Please review the highlighted fields.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/register-salon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const json = (await response.json()) as RegisterResponse & {
        error?: {
          message?: string;
          details?: { fieldErrors?: Record<string, string[]> };
        };
      };

      if (!response.ok) {
        if (json.error?.details?.fieldErrors) {
          setFieldErrors(json.error.details.fieldErrors);
        }
        setErrorMessage(json.error?.message ?? "Unable to register salon.");
        return;
      }

      setRegistered(json);
    } catch {
      setErrorMessage("Network error while creating your salon. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (registered) {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-status-completed-bg text-status-completed-fg">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-ink">Salon Account Created</h2>
          <p className="text-sm text-ink-secondary">
            Your salon URL{" "}
            <span className="font-mono text-ink">
              /salon/{registered.salonSlug}/{registered.branchSlug}
            </span>{" "}
            is reserved. Please verify your email before signing in.
          </p>
        </div>

        {registered.devVerificationPath ? (
          <div className="space-y-3">
            <a
              href={registered.devVerificationPath}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-control bg-brand-primary px-5 py-3 text-base font-semibold text-brand-foreground transition hover:opacity-95"
            >
              Verify Email &amp; Continue to Sign In
            </a>
            <Link
              href="/login"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-control border border-subtle bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-muted"
            >
              Go to Sign In
            </Link>
          </div>
        ) : (
          <Link
            href="/login"
            className="inline-flex min-h-12 w-full items-center justify-center rounded-control bg-brand-primary px-5 py-3 text-base font-semibold text-brand-foreground transition hover:opacity-95"
          >
            Go to Sign In
          </Link>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {errorMessage ? (
        <div
          role="alert"
          className="rounded-control bg-status-cancelled-bg px-4 py-3 text-sm font-medium text-status-cancelled-fg"
        >
          {errorMessage}
        </div>
      ) : null}

      {/* Bot honeypot field */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <Input
        label="Owner Full Name"
        value={ownerName}
        onChange={(e) => setOwnerName(e.target.value)}
        placeholder="Neha Kapoor"
        required
        error={fieldErrors.ownerName?.[0]}
      />

      <Input
        label="Work Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="neha@auragrooming.in"
        required
        error={fieldErrors.email?.[0]}
      />

      <Input
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="At least 8 characters"
        required
        error={fieldErrors.password?.[0]}
      />

      <Input
        label="Salon Business Name"
        value={organizationName}
        onChange={(e) => handleOrgNameChange(e.target.value)}
        placeholder="Aura Grooming Co."
        required
        error={fieldErrors.organizationName?.[0]}
      />

      <Input
        label="Salon URL Slug"
        prefix="/salon/"
        value={salonSlug}
        onChange={(e) => {
          setSlugTouched(true);
          setSalonSlug(toUrlSlug(e.target.value));
        }}
        placeholder="aura-grooming"
        hint="Customers will scan QR codes linking to /salon/your-slug/main"
        required
        error={fieldErrors.salonSlug?.[0]}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="First Branch Name"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          placeholder="Main Branch"
          required
          error={fieldErrors.branchName?.[0]}
        />
        <Input
          label="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Bengaluru"
          error={fieldErrors.city?.[0]}
        />
      </div>

      <Input
        label="Branch Phone (optional)"
        prefix="+91"
        inputMode="numeric"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="9880011223"
        error={fieldErrors.phone?.[0]}
      />

      <Button type="submit" fullWidth loading={submitting}>
        Create Salon Account
      </Button>
    </form>
  );
}
