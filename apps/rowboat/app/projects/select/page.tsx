import App from "./app";
import { requireActiveBillingSubscription } from '@/app/billing/utils';

export default async function Page() {
    await requireActiveBillingSubscription();
    return <App />
}
