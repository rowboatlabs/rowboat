import { Metadata } from "next";
import { requireActiveBillingSubscription } from '@/app/lib/billing';
import { JobRulesTabs } from "./components/job-rules-tabs";

export const metadata: Metadata = {
    title: "Job Rules",
};

export default async function Page(
    props: {
        params: Promise<{ projectId: string }>
    }
) {
    const params = await props.params;
    await requireActiveBillingSubscription();
    return <JobRulesTabs projectId={params.projectId} />;
}
