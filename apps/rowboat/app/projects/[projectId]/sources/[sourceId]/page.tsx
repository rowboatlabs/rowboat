import { SourcePage } from "./source-page";
import { requireActiveBillingSubscription } from '@/app/billing/utils';

export default async function Page({
    params,
}: {
    params: {
        projectId: string,
        sourceId: string
    }
}) {
    await requireActiveBillingSubscription();
    return <SourcePage projectId={params.projectId} sourceId={params.sourceId} />;
}