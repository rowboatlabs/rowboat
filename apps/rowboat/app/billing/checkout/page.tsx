import { PricingPage } from "./app";
import { redirect } from "next/navigation";
import { createStripePricingTableSession, requireBillingCustomer } from "@/app/lib/billing";
import { USE_BILLING } from "@/app/lib/feature_flags";

export default async function Page() {
    if (!USE_BILLING) {
        redirect('/projects');
    }

    const customer = await requireBillingCustomer();
    const response = await createStripePricingTableSession(customer._id);

    return (
        <PricingPage response={response} />
    );
}