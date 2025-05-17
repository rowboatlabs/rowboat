import { redirect } from 'next/navigation';
import { requireActiveBillingSubscription } from '../lib/billing';

export default async function Page() {
    await requireActiveBillingSubscription();
    redirect('/projects/select');
}