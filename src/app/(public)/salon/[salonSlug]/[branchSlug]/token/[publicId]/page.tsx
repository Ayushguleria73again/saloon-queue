import { notFound } from "next/navigation";
import { slugSchema } from "@/features/onboarding/schemas";
import { TokenTrackerView } from "@/features/public-intake/components/token-tracker-view";
import { publicTokenIdParamSchema } from "@/features/public-intake/schemas";
import { getEnv } from "@/lib/env";
import { NotFoundError } from "@/lib/errors";
import { getPublicTokenTracking } from "@/server/services/token-tracking-service";

export const dynamic = "force-dynamic";

export default async function PublicTokenTrackingPage(props: {
  params: Promise<{ salonSlug: string; branchSlug: string; publicId: string }>;
}) {
  const { salonSlug, branchSlug, publicId } = await props.params;

  const salonParsed = slugSchema.safeParse(salonSlug);
  const branchParsed = slugSchema.safeParse(branchSlug);
  const idParsed = publicTokenIdParamSchema.safeParse(publicId);

  if (!salonParsed.success || !branchParsed.success || !idParsed.success) {
    notFound();
  }

  let tracking;
  try {
    tracking = await getPublicTokenTracking({
      publicId: idParsed.data,
      salonSlug: salonParsed.data,
      branchSlug: branchParsed.data,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  return (
    <TokenTrackerView
      initialToken={tracking}
      vapidPublicKey={getEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY}
    />
  );
}
