import { getSession } from '@auth0/nextjs-auth0';
import { redirect } from 'next/navigation';
import { getBillingCustomer } from '../lib/billing';
import { USE_BILLING } from '../lib/feature_flags';
import { Customer } from '../lib/types/billing_types';
import { WithStringId } from '../lib/types/types';
import { z } from 'zod';
import { getDbUserForAuthUser } from '../lib/user';

/**
 * This function should be used as an initial check in server page components to ensure
 * the user has a valid billing customer record. It will:
 * 1. Return a guest customer if billing is disabled
 * 2. Verify user authentication
 * 3. Create/update the user record if needed
 * 4. Redirect to onboarding if no billing customer exists
 * 
 * Usage in server components:
 * ```ts
 * const billingCustomer = await requireBillingCustomer();
 * ```
 */
export async function requireBillingCustomer(): Promise<WithStringId<z.infer<typeof Customer>>> {
    // fetch auth0 user
    const { user } = await getSession() || {};
    if (!user) {
        throw new Error('User not authenticated');
    }

    // fetch db user
    const dbUser = await getDbUserForAuthUser(user);
    if (!dbUser) {
        throw new Error('User not found');
    }

    if (!USE_BILLING) {
        return {
            _id: "guest_customer",
            userId: dbUser._id,
            name: "Guest",
            email: "guest@rowboatlabs.com",
            stripeCustomerId: "guest",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            subscriptionPlan: "free" as const,
            subscriptionActive: true,
        };
    }

    // check if user has a billing customer id
    if (!dbUser.billingCustomerId) {
        redirect('/billing/onboarding');
    }

    // fetch billing customer
    const billingCustomer = await getBillingCustomer(dbUser.billingCustomerId);
    if (!billingCustomer) {
        redirect('/billing/onboarding');
    }

    return billingCustomer;
}

/**
 * This function should be used in server page components to ensure the user has an active
 * billing subscription. It will:
 * 1. Return a guest customer if billing is disabled
 * 2. Verify the user has a valid billing customer record
 * 3. Redirect to checkout if the subscription is not active
 * 
 * Usage in server components:
 * ```ts
 * const billingCustomer = await requireActiveBillingSubscription();
 * ```
 */
export async function requireActiveBillingSubscription(): Promise<WithStringId<z.infer<typeof Customer>>> {
    const billingCustomer = await requireBillingCustomer();

    if (USE_BILLING && !billingCustomer?.subscriptionActive) {
        redirect('/billing/checkout');
    }
    return billingCustomer;
}
