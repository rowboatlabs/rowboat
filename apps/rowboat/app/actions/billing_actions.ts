"use server";
import { authorize, logUsage, getBillingCustomer, createCustomerPortalSession } from "../lib/billing";
import { authCheck } from "./auth_actions";
import { USE_BILLING } from "../lib/feature_flags";
import { AuthorizeRequest, AuthorizeResponse, LogUsageRequest } from "../lib/types/billing_types";
import { z } from "zod";
import { redirect } from "next/navigation";
import { User } from "../lib/types/types";

export async function requireBillingProfile(): Promise<z.infer<typeof User> & { billingCustomerId: string }> {
    const user = await authCheck();
    if (!USE_BILLING) {
        return {
            ...user,
            billingCustomerId: 'guest-user',
        };
    }
    if (!user.billingCustomerId) {
        redirect('/billing/onboarding');
    }
    return {
        ...user,
        billingCustomerId: user.billingCustomerId,
    };
}

export async function authorizeUserAction(request: z.infer<typeof AuthorizeRequest>): Promise<z.infer<typeof AuthorizeResponse>> {
    if (!USE_BILLING) {
        return { success: true };
    }

    const user = await requireBillingProfile();
    const response = await authorize(user.billingCustomerId, request);
    return response;
}

export async function logBillingUsage(request: z.infer<typeof LogUsageRequest>) {
    if (!USE_BILLING) {
        return;
    }

    const user = await requireBillingProfile();
    await logUsage(user.billingCustomerId, request);
    return;
}

export async function getCustomerPortalUrl(returnUrl: string): Promise<string> {
    if (!USE_BILLING) {
        return "";
    }
    
    const user = await requireBillingProfile();
    const customer = await getBillingCustomer(user.billingCustomerId);
    if (!customer) {
        throw new Error("Customer not found");
    }
    return await createCustomerPortalSession(customer._id, returnUrl);
}
