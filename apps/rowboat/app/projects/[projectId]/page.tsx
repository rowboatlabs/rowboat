import { redirect } from "next/navigation";
import { requireActiveBillingSubscription } from '@/app/lib/billing';

export default async function Page({
    params
}: {
    params: { projectId: string }
}) {
    await requireActiveBillingSubscription();
    redirect(`/projects/${params.projectId}/workflow`);
}