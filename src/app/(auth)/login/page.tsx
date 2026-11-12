import { Suspense } from "react";
import Link from "next/link";
import { Scissors } from "lucide-react";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata = {
  title: "Sign In — SalonFlow",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md rounded-card border border-subtle bg-surface p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-control bg-brand-primary text-brand-foreground">
            <Scissors className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Sign in to SalonFlow
          </h1>
          <p className="mt-1.5 text-sm text-ink-secondary">
            Manage your salon queues, branches, staff, and live notifications.
          </p>
        </div>

        <Suspense
          fallback={
            <div className="space-y-4 py-4 text-center text-sm text-ink-secondary">
              Loading sign-in form…
            </div>
          }
        >
          <LoginForm />
        </Suspense>

        <div className="mt-6 border-t border-subtle pt-4 text-center text-sm text-ink-secondary">
          <Link
            href="/"
            className="font-medium text-ink underline-offset-4 hover:underline"
          >
            Back to SalonFlow home
          </Link>
        </div>
      </div>
    </main>
  );
}
