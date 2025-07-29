import { Metadata } from "next";
import { SimpleConfigApp } from "./app";
import { requireActiveBillingSubscription } from '@/app/lib/billing';

export const metadata: Metadata = {
    title: "Project Settings",
};

export default async function Page(
    props: {
        params: Promise<{
            projectId: string;
        }>;
    }
) {
    const params = await props.params;
    await requireActiveBillingSubscription();
    return <SimpleConfigApp
        projectId={params.projectId}
    />;
}