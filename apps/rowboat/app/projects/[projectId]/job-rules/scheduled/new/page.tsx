import { Metadata } from "next";
import { requireActiveBillingSubscription } from '@/app/lib/billing';
import { CreateScheduledJobRuleForm } from "../components/create-scheduled-job-rule-form";

export const metadata: Metadata = {
    title: "Create Scheduled Job Rule",
};

export default async function Page(
    props: {
        params: Promise<{ projectId: string }>
    }
) {
    const params = await props.params;
    await requireActiveBillingSubscription();
    return <CreateScheduledJobRuleForm projectId={params.projectId} />;
}
