import { USE_AUTH, USE_BILLING } from "../lib/feature_flags";
import AppLayout from './layout/components/app-layout';

export const dynamic = 'force-dynamic';

export default function Layout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <AppLayout useAuth={USE_AUTH} useBilling={USE_BILLING}>
            {children}
        </AppLayout>
    );
}