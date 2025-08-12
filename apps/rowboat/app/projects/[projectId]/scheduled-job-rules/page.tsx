import { Metadata } from "next";
import { requireActiveBillingSubscription } from '@/app/lib/billing';
import { ScheduledJobRulesList } from "./components/scheduled-job-rules-list";

export const metadata: Metadata = {
    title: "Scheduled Job Rules",
};

export default async function Page(
    props: {
        params: Promise<{ projectId: string }>
    }
) {
    const params = await props.params;
    await requireActiveBillingSubscription();
    return <ScheduledJobRulesList projectId={params.projectId} />;
}
