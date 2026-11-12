"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, signIn } from "next-auth/react";
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { loginSchema, sanitizeCallbackUrl } from "@/features/auth/schemas";

function resolveInitialAuthError(errorCode: string | null): string | null {
  if (!errorCode) return null;
  if (errorCode === "RateLimited") {
    return "Too many sign-in attempts. Please wait a few minutes and try again.";
  }
  return "Your session expired. Please sign in again.";
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resending, setResending] = useState(false);
  const [devVerifyPath, setDevVerifyPath] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const verifiedNotice = searchParams.get("verified") === "1";
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    resolveInitialAuthError(searchParams.get("error")),
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setNeedsVerification(false);
    setResendNotice(null);
    setDevVerifyPath(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrorMessage(
        fieldErrors.email?.[0] ??
          fieldErrors.password?.[0] ??
          "Please enter a valid email and password.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await signIn("credentials", {
        email: parsed.data.email,
        password: parsed.data.password,
        redirect: false,
      });

      if (!result || result.error) {
        if (result?.status === 429 || result?.error === "RateLimited") {
          setErrorMessage(
            "Too many sign-in attempts. Please wait a few minutes and try again.",
          );
        } else if (result?.code === "email_not_verified") {
          setNeedsVerification(true);
          setErrorMessage("Please verify your email address before signing in.");
        } else {
          setErrorMessage("Invalid email or password.");
        }
        return;
      }

      const requestedCallback = searchParams.get("callbackUrl");
      let target: string;

      if (requestedCallback) {
        target = sanitizeCallbackUrl(requestedCallback, "/owner/dashboard");
      } else {
        const session = await getSession();
        target =
          session?.user?.isPlatformAdmin && !session.user.activeOrganizationId
            ? "/admin"
            : "/owner/dashboard";
      }

      router.push(target);
      router.refresh();
    } catch {
      setErrorMessage("Unable to sign in right now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResendVerification() {
    if (!email.trim()) return;
    setResending(true);
    setResendNotice(null);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = (await res.json()) as {
        sent?: boolean;
        devVerificationPath?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        setResendNotice(
          json.error?.message ?? "Unable to resend verification right now.",
        );
        return;
      }
      if (json.devVerificationPath) {
        setDevVerifyPath(json.devVerificationPath);
      }
      setResendNotice("A fresh verification link has been issued for your email.");
    } catch {
      setResendNotice("Unable to resend verification right now.");
    } finally {
      setResending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {verifiedNotice && !errorMessage ? (
        <div
          role="status"
          className="rounded-control bg-status-completed-bg px-4 py-3 text-sm font-medium text-status-completed-fg"
        >
          Your account is verified. Please sign in to continue.
        </div>
      ) : null}

      {errorMessage ? (
        <div
          role="alert"
          className="space-y-2 rounded-control bg-status-cancelled-bg px-4 py-3 text-sm font-medium text-status-cancelled-fg"
        >
          <p>{errorMessage}</p>
          {needsVerification ? (
            <div className="pt-1">
              <button
                type="button"
                disabled={resending}
                onClick={handleResendVerification}
                className="inline-flex min-h-10 items-center rounded-control border border-status-cancelled-fg/30 bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-muted disabled:opacity-50"
              >
                {resending ? "Sending…" : "Resend Verification Link"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {resendNotice ? (
        <div
          role="status"
          className="space-y-2 rounded-control border border-subtle bg-muted px-4 py-3 text-xs text-ink"
        >
          <p className="font-medium">{resendNotice}</p>
          {devVerifyPath ? (
            <a
              href={devVerifyPath}
              className="inline-flex min-h-10 items-center justify-center rounded-control bg-brand-primary px-4 py-2 text-xs font-semibold text-brand-foreground"
            >
              Verify Email Now
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium text-ink">
          Work Email
        </label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary"
            aria-hidden="true"
          />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@salonflow.in"
            className="min-h-12 w-full rounded-control border border-subtle bg-surface pl-10 pr-4 text-base text-ink placeholder:text-ink-secondary/60 focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium text-ink">
          Password
        </label>
        <div className="relative">
          <Lock
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary"
            aria-hidden="true"
          />
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="min-h-12 w-full rounded-control border border-subtle bg-surface pl-10 pr-12 text-base text-ink placeholder:text-ink-secondary/60 focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20"
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-control text-ink-secondary transition hover:bg-muted hover:text-ink"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand-primary px-5 py-3 text-base font-semibold text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Signing in…</span>
          </>
        ) : (
          <span>Sign In to SalonFlow</span>
        )}
      </button>
    </form>
  );
}
