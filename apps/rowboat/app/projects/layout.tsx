import { USE_AUTH, USE_BILLING, USE_RAG } from "../lib/feature_flags";
import AppLayout from './layout/components/app-layout';

export const dynamic = 'force-dynamic';

export default function Layout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <AppLayout useRag={USE_RAG} useAuth={USE_AUTH} useBilling={USE_BILLING}>
            {children}
        </AppLayout>
    );
}