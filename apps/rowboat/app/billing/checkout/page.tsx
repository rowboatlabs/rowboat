import { PricingPage } from "./app";
import { redirect } from "next/navigation";
import { createStripePricingTableSession, getBillingCustomer } from "@/app/lib/billing";
import { requireBillingCustomer } from '../utils';
import { USE_BILLING } from "@/app/lib/feature_flags";

export const dynamic = 'force-dynamic';

export default async function Page() {
    if (!USE_BILLING) {
        redirect('/projects');
    }

    const customer = await requireBillingCustomer();

    // fetch customer info from billing service
    // if customer already has a subscription, redirect to billing page
    const customerInfo = await getBillingCustomer(customer._id);
    if (customerInfo?.subscriptionActive) {
        redirect('/billing');
    }

    const response = await createStripePricingTableSession(customer._id);

    return (
        <PricingPage response={response} />
    );
}