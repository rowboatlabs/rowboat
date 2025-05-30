import { Metadata } from "next";
import App from "./app";
import { USE_CHAT_WIDGET } from "@/app/lib/feature_flags";
import { requireActiveBillingSubscription } from '@/app/lib/billing';

export const metadata: Metadata = {
    title: "Project config",
};

export default async function Page({
    params,
}: {
    params: {
        projectId: string;
    };
}) {
    await requireActiveBillingSubscription();
    return <App
        projectId={params.projectId}
        useChatWidget={USE_CHAT_WIDGET}
        chatWidgetHost={process.env.CHAT_WIDGET_HOST || ''}
    />;
}