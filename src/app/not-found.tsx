import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-mono text-sm font-semibold uppercase tracking-wider text-ink-secondary">
        404
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        The requested SalonFlow page does not exist or has moved.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-12 items-center justify-center rounded-control bg-brand-primary px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:opacity-95"
      >
        Return Home
      </Link>
    </main>
  );
}
