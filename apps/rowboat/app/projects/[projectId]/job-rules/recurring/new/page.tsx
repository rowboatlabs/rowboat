import { Metadata } from "next";
import { requireActiveBillingSubscription } from '@/app/lib/billing';
import { CreateRecurringJobRuleForm } from "../../components/create-recurring-job-rule-form";

export const metadata: Metadata = {
    title: "Create Recurring Job Rule",
};

export default async function Page(
    props: {
        params: Promise<{ projectId: string }>
    }
) {
    const params = await props.params;
    await requireActiveBillingSubscription();
    return <CreateRecurringJobRuleForm projectId={params.projectId} />;
}
