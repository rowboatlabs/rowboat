import { redirect } from 'next/navigation';
import { requireActiveBillingSubscription } from '../billing/utils';

export default async function Page() {
    await requireActiveBillingSubscription();
    redirect('/projects/select');
}