import { syncWithStripe } from "@/app/lib/billing";
import { requireBillingCustomer } from '../utils';
import { redirect } from "next/navigation";

export const dynamic = 'force-dynamic';

export default async function Page() {
    const customer = await requireBillingCustomer();
    await syncWithStripe(customer._id);
    redirect('/projects');
}