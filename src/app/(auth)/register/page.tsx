import Link from "next/link";
import { Scissors } from "lucide-react";
import { RegisterSalonForm } from "@/features/onboarding/components/register-salon-form";

export const metadata = {
  title: "Register Your Salon — SalonFlow",
};

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-lg rounded-card border border-subtle bg-surface p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-control bg-brand-primary text-brand-foreground">
            <Scissors className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Register Your Salon
          </h1>
          <p className="mt-1.5 text-sm text-ink-secondary">
            Launch digital QR queues and mobile push notifications in under a minute.
          </p>
        </div>

        <RegisterSalonForm />

        <div className="mt-6 border-t border-subtle pt-4 text-center text-sm text-ink-secondary">
          Already registered?{" "}
          <Link href="/login" className="font-semibold text-ink hover:underline">
            Sign in here
          </Link>
        </div>
      </div>
    </main>
  );
}
