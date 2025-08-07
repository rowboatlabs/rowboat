import { Metadata } from "next";
import { requireActiveBillingSubscription } from '@/app/lib/billing';
import { JobView } from "../components/job-view";

export const metadata: Metadata = {
    title: "Job",
};

export default async function Page(
    props: {
        params: Promise<{ projectId: string, jobId: string }>
    }
) {
    const params = await props.params;
    await requireActiveBillingSubscription();
    return <JobView projectId={params.projectId} jobId={params.jobId} />;
}
