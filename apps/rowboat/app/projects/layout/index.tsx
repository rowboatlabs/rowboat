import { USE_RAG } from "@/app/lib/feature_flags";
import AppLayout from './components/app-layout';

export default async function Layout({
    params,
    children
}: {
    params: { projectId: string }
    children: React.ReactNode
}) {
    return (
        <AppLayout>
            {children}
        </AppLayout>
    );
} 