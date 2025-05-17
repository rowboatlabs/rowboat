import { requireBillingCustomer, syncWithStripe } from "@/app/lib/billing";
import { redirect } from "next/navigation";

export default async function Page() {
    const customer = await requireBillingCustomer();
    await syncWithStripe(customer._id);
    redirect('/projects');
}