"use server";

import { createBillingCustomer, authorize, logUsage } from "../lib/billing";
import { usersCollection } from "../lib/mongodb";
import { authCheck } from "./actions";
import { USE_BILLING } from "../lib/feature_flags";
import { AuthorizeRequest, AuthorizeResponse, LogUsageRequest } from "../lib/types/billing_types";
import { z } from "zod";
import { getSession } from "@auth0/nextjs-auth0";

export async function createBillingProfile(name: string, email: string) {
    if (!USE_BILLING) {
        return;
    }

    const user = await authCheck();

    // fetch user from db
    const dbUser = await usersCollection.findOne({
        auth0Id: user.sub,
    });
    if (!dbUser) {
        throw new Error('User not found');
    }

    // create billing customer
    const billingCustomer = await createBillingCustomer(dbUser._id.toString(), email, name);

    // update customer id in db
    await usersCollection.updateOne({
        auth0Id: user.sub,
    }, {
        $set: {
            billingCustomerId: billingCustomer._id,
            updatedAt: new Date().toISOString(),
        }
    });
}

export async function authorizeUserAction(request: z.infer<typeof AuthorizeRequest>): Promise<z.infer<typeof AuthorizeResponse>> {
    if (!USE_BILLING) {
        return { success: true };
    }

    // fetch user
    const user = await authCheck();

    // fetch user from db
    const dbUser = await usersCollection.findOne({
        auth0Id: user.sub,
    });
    if (!dbUser) {
        throw new Error('User not found');
    }

    // ensure billing customer exists
    if (!dbUser.billingCustomerId) {
        throw new Error('Billing customer not found');
    }

    const response = await authorize(dbUser.billingCustomerId, request);
    return response;
}

export async function logBillingUsage(request: z.infer<typeof LogUsageRequest>) {
    if (!USE_BILLING) {
        return;
    }

    const user = await authCheck();

    // fetch user from db
    const dbUser = await usersCollection.findOne({
        auth0Id: user.sub,
    });
    if (!dbUser) {
        throw new Error('User not found');
    }

    // ensure billing customer exists
    if (!dbUser.billingCustomerId) {
        throw new Error('Billing customer not found');
    }

    // log usage
    await logUsage(dbUser.billingCustomerId, request);
    return;
}