"use server";

import { createBillingCustomer } from "../lib/billing";
import { usersCollection } from "../lib/mongodb";
import { authCheck } from "./actions";
import { USE_BILLING } from "../lib/feature_flags";

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
