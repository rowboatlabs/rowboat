import { Metadata } from "next";
import { requireActiveBillingSubscription } from '@/app/lib/billing';
import { ScheduledJobRuleView } from "../components/scheduled-job-rule-view";

export const metadata: Metadata = {
    title: "Scheduled Job Rule",
};

export default async function Page(
    props: {
        params: Promise<{ projectId: string; ruleId: string }>
    }
) {
    const params = await props.params;
    await requireActiveBillingSubscription();
    return <ScheduledJobRuleView projectId={params.projectId} ruleId={params.ruleId} />;
}
