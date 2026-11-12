import Link from "next/link";
import { FoundationBadge } from "@/components/ui/foundation-badge";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
      <FoundationBadge />
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        SalonFlow
      </h1>
      <p className="mt-3 max-w-lg text-base text-ink-secondary">
        Multi-tenant QR queue management, strict FIFO token engine, and real-time Web Push
        alerts for modern salons.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/register"
          className="inline-flex min-h-12 items-center justify-center rounded-control bg-brand-primary px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:opacity-95"
        >
          Register Your Salon
        </Link>
        <Link
          href="/login"
          className="inline-flex min-h-12 items-center justify-center rounded-control border border-subtle bg-surface px-6 py-3 text-sm font-semibold text-ink transition hover:bg-muted"
        >
          Owner &amp; Staff Sign In
        </Link>
      </div>
      <div className="mt-6 rounded-card border border-subtle bg-surface px-6 py-4 text-sm text-ink-secondary shadow-sm">
        Multi-tenant salon onboarding, branch management, and RBAC active. Customer &amp;
        queue portals launch next.
      </div>
    </main>
  );
}
