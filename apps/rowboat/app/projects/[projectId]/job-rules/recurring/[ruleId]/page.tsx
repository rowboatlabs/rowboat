import { Metadata } from "next";
import { requireActiveBillingSubscription } from '@/app/lib/billing';
import { RecurringJobRuleView } from "../../components/recurring-job-rule-view";

export const metadata: Metadata = {
    title: "Recurring Job Rule",
};

export default async function Page(
    props: {
        params: Promise<{ projectId: string; ruleId: string }>
    }
) {
    const params = await props.params;
    await requireActiveBillingSubscription();
    return <RecurringJobRuleView projectId={params.projectId} ruleId={params.ruleId} />;
}
