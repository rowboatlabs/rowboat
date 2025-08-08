import { Metadata } from "next";
import { requireActiveBillingSubscription } from '@/app/lib/billing';
import { JobsList } from "./components/jobs-list";

export const metadata: Metadata = {
    title: "Jobs",
};

export default async function Page(
    props: {
        params: Promise<{ projectId: string }>
    }
) {
    const params = await props.params;
    await requireActiveBillingSubscription();
    return <JobsList projectId={params.projectId} />;
}
