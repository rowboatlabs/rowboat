import { Metadata } from "next";
import { requireActiveBillingSubscription } from '@/app/lib/billing';
import { ConversationView } from "../components/conversation-view";

export const metadata: Metadata = {
    title: "Conversation",
};

export default async function Page(
    props: {
        params: Promise<{ projectId: string, conversationId: string }>
    }
) {
    const params = await props.params;
    await requireActiveBillingSubscription();
    return <ConversationView projectId={params.projectId} conversationId={params.conversationId} />;
}


