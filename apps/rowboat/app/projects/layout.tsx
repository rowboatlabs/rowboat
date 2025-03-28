import { USE_AUTH } from "../lib/feature_flags";
import AppLayout from './layout/components/app-layout';

export const dynamic = 'force-dynamic';

export default function Layout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <AppLayout>
            {children}
        </AppLayout>
    );
}