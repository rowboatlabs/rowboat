"use server";
import { authorize, logUsage, getBillingCustomer, createCustomerPortalSession, createStripeUpgradePricingTableSession } from "../lib/billing";
import { authCheck } from "./auth_actions";
import { USE_BILLING } from "../lib/feature_flags";
import { AuthorizeRequest, AuthorizeResponse, LogUsageRequest, PricingTableResponse, Customer } from "../lib/types/billing_types";
import { z } from "zod";
import { WithStringId } from "../lib/types/types";

async function getCustomer(): Promise<WithStringId<z.infer<typeof Customer>>> {
    const user = await authCheck();
    if (!user.billingCustomerId) {
        throw new Error("Customer not found");
    }
    const customer = await getBillingCustomer(user.billingCustomerId);
    if (!customer) {
        throw new Error("Customer not found");
    }
    return customer;
}

export async function authorizeUserAction(request: z.infer<typeof AuthorizeRequest>): Promise<z.infer<typeof AuthorizeResponse>> {
    if (!USE_BILLING) {
        return { success: true };
    }

    const customer = await getCustomer();
    const response = await authorize(customer._id, request);
    return response;
}

export async function logBillingUsage(request: z.infer<typeof LogUsageRequest>) {
    if (!USE_BILLING) {
        return;
    }

    const customer = await getCustomer();
    await logUsage(customer._id, request);
    return;
}

export async function getCustomerPortalUrl(returnUrl: string): Promise<string> {
    if (!USE_BILLING) {
        throw new Error("Billing is not enabled")
    }

    const customer = await getCustomer();
    return await createCustomerPortalSession(customer._id, returnUrl);
}

export async function getUpgradePricingTableSession(): Promise<z.infer<typeof PricingTableResponse>> {
    if (!USE_BILLING) {
        throw new Error("Billing is not enabled");
    }

    const customer = await getCustomer();
    const response = await createStripeUpgradePricingTableSession(customer._id);
    return response;
}