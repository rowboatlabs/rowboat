import { requireBillingCustomer } from '../lib/billing';
import { BillingPage } from './app';
import { getUsage } from '../lib/billing';
import { redirect } from 'next/navigation';
import { USE_BILLING } from '../lib/feature_flags';

export const dynamic = 'force-dynamic';

export default async function Page() {
    if (!USE_BILLING) {
        redirect('/projects');
    }

    const customer = await requireBillingCustomer();
    const usage = await getUsage(customer._id);
    return <BillingPage customer={customer} usage={usage} />;
}