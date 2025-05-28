import App from "./app";
import { requireActiveBillingSubscription } from '@/app/lib/billing';

export default async function Page() {
    await requireActiveBillingSubscription();
    return <App />
}
