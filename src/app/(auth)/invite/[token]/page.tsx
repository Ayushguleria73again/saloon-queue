import Link from "next/link";
import { UserPlus } from "lucide-react";
import { InviteAcceptForm } from "@/features/staff/components/invite-accept-form";
import { getInvitePreview } from "@/server/services/staff-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Accept Staff Invitation — SalonFlow",
};

export default async function AcceptInvitePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;

  let preview: Awaited<ReturnType<typeof getInvitePreview>> | null = null;
  let errorMessage: string | null = null;

  try {
    preview = await getInvitePreview(token);
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : "This invitation link is invalid or has expired.";
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md rounded-card border border-subtle bg-surface p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-control bg-brand-primary text-brand-foreground">
            <UserPlus className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Join Salon Team</h1>
        </div>

        {preview ? (
          <InviteAcceptForm
            token={token}
            organizationName={preview.organizationName}
            roleName={preview.roleName}
            initialName={preview.memberName}
            maskedEmail={preview.maskedEmail}
          />
        ) : (
          <div className="space-y-4 text-center">
            <div
              role="alert"
              className="rounded-control bg-status-cancelled-bg px-4 py-3 text-sm font-medium text-status-cancelled-fg"
            >
              {errorMessage}
            </div>
            <Link
              href="/login"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-control border border-subtle bg-surface px-5 py-3 text-sm font-semibold text-ink hover:bg-muted"
            >
              Go to Sign In
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
