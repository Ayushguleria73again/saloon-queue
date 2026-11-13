"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock } from "lucide-react";
import { Button, Input, ServiceCard, Textarea } from "@/components/ui";
import { publicCreateTokenSchema } from "@/features/public-intake/schemas";
import type { PublicServiceOption } from "@/features/public-intake/types";
import { formatDurationMinutes, formatPaiseToInr } from "@/lib/formatters";
import { tryNormalizeIndianMobile } from "@/lib/phone";

interface CustomerIntakeFormProps {
  salonSlug: string;
  branchSlug: string;
  branchId: string;
  qrToken?: string | null;
  services: PublicServiceOption[];
}

function generateClientUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  const timeHex = Date.now().toString(16).padStart(12, "0").slice(-12);
  const randHex = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  return `${randHex}-${timeHex.slice(0, 4)}-4${timeHex.slice(4, 7)}-8${timeHex.slice(7, 10)}-${randHex}${timeHex.slice(0, 4)}`;
}

export function CustomerIntakeForm({
  salonSlug,
  branchSlug,
  branchId,
  qrToken,
  services,
}: CustomerIntakeFormProps) {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [idempotencyKey] = useState(() => generateClientUuid());

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>(
    {},
  );
  const [activeTokenShortcut, setActiveTokenShortcut] = useState<{
    publicId: string;
    tokenNumber?: string;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`salonflow_active_token_${branchId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { publicId?: string; tokenNumber?: string };
      if (parsed.publicId) {
        setActiveTokenShortcut({
          publicId: parsed.publicId,
          tokenNumber: parsed.tokenNumber,
        });
      }
    } catch {
      // Ignore corrupt localStorage entries safely
    }
  }, [branchId]);

  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  const selectedSummary = useMemo(() => {
    let totalPaise = 0;
    let totalMinutes = 0;
    for (const id of selectedIds) {
      const svc = serviceById.get(id);
      if (svc) {
        totalPaise += svc.priceInPaise;
        totalMinutes += svc.durationMinutes;
      }
    }
    return { count: selectedIds.length, totalPaise, totalMinutes };
  }, [selectedIds, serviceById]);

  function toggleService(serviceId: string) {
    setSelectedIds((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId],
    );
  }

  function handleMobileBlur() {
    if (!mobileNumber.trim()) return;
    const normalized = tryNormalizeIndianMobile(mobileNumber);
    if (!normalized) {
      setFieldErrors((prev) => ({
        ...prev,
        mobileNumber: ["Enter a valid 10-digit mobile number starting with 6–9."],
      }));
    } else {
      setMobileNumber(normalized);
      setFieldErrors((prev) => ({ ...prev, mobileNumber: undefined }));
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setFieldErrors({});

    const parsed = publicCreateTokenSchema.safeParse({
      fullName,
      mobileNumber,
      serviceIds: selectedIds,
      notes: notes || undefined,
      idempotencyKey,
      qrToken: qrToken ?? undefined,
      website,
    });

    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors);
      setErrorMessage("Please review the highlighted fields before continuing.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/public/salons/${encodeURIComponent(salonSlug)}/${encodeURIComponent(branchSlug)}/tokens`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );

      const json = (await response.json().catch(() => ({}))) as {
        token?: { publicId: string; tokenNumber: string };
        redirectUrl?: string;
        error?: {
          message?: string;
          details?: { fieldErrors?: Record<string, string[]> };
        };
      };

      if (!response.ok) {
        if (json.error?.details?.fieldErrors) {
          setFieldErrors(json.error.details.fieldErrors);
        }
        setErrorMessage(json.error?.message ?? "Unable to generate token right now.");
        return;
      }

      if (json.token?.publicId) {
        try {
          window.localStorage.setItem(
            `salonflow_active_token_${branchId}`,
            JSON.stringify({
              publicId: json.token.publicId,
              tokenNumber: json.token.tokenNumber,
            }),
          );
        } catch {
          // Ignore storage quota errors
        }
      }

      if (json.redirectUrl) {
        router.push(json.redirectUrl);
      }
    } catch {
      setErrorMessage("Network error while joining the queue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 pb-28" noValidate>
      {activeTokenShortcut ? (
        <Link
          href={`/salon/${salonSlug}/${branchSlug}/token/${activeTokenShortcut.publicId}`}
          className="flex min-h-12 items-center justify-between gap-3 rounded-card border border-brand-accent/40 bg-status-waiting-bg px-4 py-3 text-sm font-semibold text-status-waiting-fg transition hover:opacity-95"
        >
          <span>
            You already have an active token
            {activeTokenShortcut.tokenNumber
              ? ` (${activeTokenShortcut.tokenNumber})`
              : ""}
          </span>
          <span className="inline-flex items-center gap-1">
            View Ticket <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </Link>
      ) : null}

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-control bg-status-cancelled-bg px-4 py-3 text-sm font-medium text-status-cancelled-fg"
        >
          {errorMessage}
        </div>
      ) : null}

      {/* Invisible bot trap */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="intake-website">Website</label>
        <input
          id="intake-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <section className="space-y-4 rounded-card border border-subtle bg-surface p-4 shadow-sm sm:p-5">
        <Input
          label="Full Name"
          name="fullName"
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Rahul Sharma"
          required
          error={fieldErrors.fullName?.[0]}
        />

        <Input
          label="Mobile Number"
          name="mobileNumber"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          prefix="+91"
          value={mobileNumber}
          onChange={(e) => setMobileNumber(e.target.value)}
          onBlur={handleMobileBlur}
          placeholder="9876543210"
          hint="Used for duplicate prevention & turn updates. Masked on public ticket screens."
          required
          error={fieldErrors.mobileNumber?.[0]}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Select Services</h2>
          <span className="text-xs text-ink-secondary">Choose 1 or more</span>
        </div>

        {fieldErrors.serviceIds?.[0] ? (
          <p role="alert" className="text-xs font-medium text-status-cancelled-fg">
            {fieldErrors.serviceIds[0]}
          </p>
        ) : null}

        {services.length === 0 ? (
          <div className="rounded-card border border-subtle bg-surface p-5 text-center text-sm text-ink-secondary">
            No services are currently configured for online booking at this branch.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {services.map((service) => (
              <ServiceCard
                key={service.id}
                id={service.id}
                name={service.name}
                description={service.description}
                priceInPaise={service.priceInPaise}
                durationMinutes={service.durationMinutes}
                selected={selectedIds.includes(service.id)}
                onToggle={toggleService}
              />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-card border border-subtle bg-surface p-4 shadow-sm sm:p-5">
        <Textarea
          label="Additional Instructions (optional)"
          name="notes"
          maxLength={300}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Preferred stylist, short fade on sides, sensitive skin..."
          error={fieldErrors.notes?.[0]}
        />
      </section>

      {/* Sticky Bottom Checkout Bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-subtle bg-surface/95 px-4 py-3 pb-safe backdrop-blur">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold tabular-nums text-ink">
              {selectedSummary.count}{" "}
              {selectedSummary.count === 1 ? "service" : "services"} •{" "}
              {formatPaiseToInr(selectedSummary.totalPaise)}
            </p>
            <p className="inline-flex items-center gap-1 text-xs text-ink-secondary">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="font-mono tabular-nums">
                {formatDurationMinutes(selectedSummary.totalMinutes)} est.
              </span>
            </p>
          </div>

          <Button
            type="submit"
            size="lg"
            loading={submitting}
            disabled={services.length === 0}
            className="shrink-0"
          >
            Get Queue Token
          </Button>
        </div>
      </div>
    </form>
  );
}
