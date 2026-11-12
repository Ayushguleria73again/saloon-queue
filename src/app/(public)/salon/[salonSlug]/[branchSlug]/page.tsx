import { notFound } from "next/navigation";
import { AlertTriangle, Clock, MapPin, QrCode, Scissors } from "lucide-react";
import { CustomerIntakeForm } from "@/features/public-intake/components/customer-intake-form";
import { NotFoundError } from "@/lib/errors";
import { getPublicBranchSnapshot } from "@/server/services/branch-public-service";

export const dynamic = "force-dynamic";

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export default async function PublicBranchIntakePage(props: {
  params: Promise<{ salonSlug: string; branchSlug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { salonSlug, branchSlug } = await props.params;
  const { t } = await props.searchParams;

  let snapshot;
  try {
    snapshot = await getPublicBranchSnapshot({
      salonSlug,
      branchSlug,
      qrToken: t ?? null,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const { organization, branch, intake, services, businessHours } = snapshot;

  return (
    <main className="space-y-5">
      {/* Salon + Branch Header */}
      <header className="rounded-card border border-subtle bg-surface p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-accent">
              {organization.name}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">
              {branch.name}
            </h1>
            {branch.city || branch.address ? (
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-secondary">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{[branch.address, branch.city].filter(Boolean).join(", ")}</span>
              </p>
            ) : null}
          </div>

          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-primary text-brand-foreground">
            <Scissors className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
          {intake.canAcceptTokens ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-status-completed-bg px-3 py-1 text-xs font-semibold text-status-completed-fg">
                Open Now
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 font-mono text-xs font-medium tabular-nums text-ink">
                <Clock className="h-3.5 w-3.5 text-ink-secondary" aria-hidden="true" />
                {intake.waitingCount} waiting • ~{intake.estimatedNewJoinWaitMinutes} mins
                approx.
              </span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-status-skipped-bg px-3 py-1 text-xs font-semibold text-status-skipped-fg">
              Queue Unavailable
            </span>
          )}
        </div>
      </header>

      {/* Unavailable / Closed / QR Verification / Intake States */}
      {intake.reason === "TENANT_SUSPENDED" || intake.reason === "BRANCH_INACTIVE" ? (
        <section className="rounded-card border border-subtle bg-surface p-6 text-center shadow-sm">
          <AlertTriangle
            className="mx-auto h-8 w-8 text-status-waiting-fg"
            aria-hidden="true"
          />
          <h2 className="mt-3 text-lg font-semibold text-ink">
            Branch Currently Unavailable
          </h2>
          <p className="mt-1.5 text-sm text-ink-secondary">
            {intake.reason === "TENANT_SUSPENDED"
              ? "This salon account is temporarily unavailable for online queue check-in."
              : "This branch is currently inactive. Please check with salon staff at the front desk."}
          </p>
        </section>
      ) : intake.reason === "QR_TOKEN_INVALID" ? (
        <section className="rounded-card border border-subtle bg-surface p-6 text-center shadow-sm">
          <QrCode className="mx-auto h-8 w-8 text-brand-accent" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold text-ink">
            Scan Official Branch QR Code
          </h2>
          <p className="mt-1.5 text-sm text-ink-secondary">
            This branch requires scanning the official QR code displayed inside the salon
            to join the queue.
          </p>
        </section>
      ) : intake.reason === "BRANCH_CLOSED" || intake.reason === "QUEUE_PAUSED" ? (
        <section className="space-y-4 rounded-card border border-subtle bg-surface p-6 shadow-sm">
          <div className="text-center">
            <Clock className="mx-auto h-8 w-8 text-ink-secondary" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-ink">
              {intake.reason === "QUEUE_PAUSED"
                ? "Queue Temporarily Paused"
                : "Branch Currently Closed"}
            </h2>
            <p className="mt-1.5 text-sm text-ink-secondary">
              {intake.pausedReason ??
                "Online token registration is available during branch operating hours below."}
            </p>
          </div>

          {businessHours.length > 0 ? (
            <div className="border-t border-subtle pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                Weekly Operating Hours
              </h3>
              <ul className="mt-2 divide-y divide-subtle text-sm">
                {businessHours.map((row) => (
                  <li
                    key={row.dayOfWeek}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="font-medium text-ink">
                      {DAY_LABELS[row.dayOfWeek]}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-ink-secondary">
                      {row.isOpen ? `${row.openTime} – ${row.closeTime}` : "Closed"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : (
        <CustomerIntakeForm
          salonSlug={organization.slug}
          branchSlug={branch.slug}
          branchId={branch.id}
          qrToken={t ?? null}
          services={services}
        />
      )}
    </main>
  );
}
