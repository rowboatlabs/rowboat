import { Metadata } from "next";
import { SourcesList } from "./components/sources-list";
import { requireActiveBillingSubscription } from '@/app/lib/billing';

export const metadata: Metadata = {
    title: "Data sources",
}

export default async function Page({
    params,
}: {
    params: { projectId: string }
}) {
    await requireActiveBillingSubscription();
    return <SourcesList 
        projectId={params.projectId} 
    />;
}