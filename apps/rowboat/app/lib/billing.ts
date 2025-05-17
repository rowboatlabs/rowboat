import { redirect } from 'next/navigation';
import { USE_BILLING } from '@/app/lib/feature_flags'
import { usersCollection } from './mongodb';
import { getSession } from '@auth0/nextjs-auth0';
import { WithStringId } from './types/types';
import { z } from 'zod';
import { Customer, PricingTableSession } from './types/billing_types';

const BILLING_API_URL = process.env.BILLING_API_URL || 'http://billing';
const BILLING_API_KEY = process.env.BILLING_API_KEY || 'test';

const GUEST_CUSTOMER: WithStringId<z.infer<typeof Customer>> = {
    _id: 'guest_user',
    userId: 'guest_user',
    name: 'Guest',
    email: 'guestuser@rowboatlabs.com',
    stripeCustomerId: 'guest',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    subscriptionPlan: 'free' as const,
    subscriptionActive: true,
    subscriptionPlanUpdatedAt: new Date().toISOString(),
}

export async function getBillingCustomer(id: string): Promise<WithStringId<z.infer<typeof Customer>> | null> {
    const response = await fetch(`${BILLING_API_URL}/api/customers/${id}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${BILLING_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch billing customer: ${response.status} ${response.statusText} ${await response.text()}`);
    }
    const json = await response.json();
    const parseResult = Customer.safeParse(json);
    if (!parseResult.success) {
        throw new Error(`Failed to parse billing customer: ${JSON.stringify(parseResult.error)}`);
    }
    return parseResult.data as z.infer<typeof Customer>;
}

export async function createBillingCustomer(userId: string, email: string, name: string): Promise<WithStringId<z.infer<typeof Customer>>> {
    const response = await fetch(`${BILLING_API_URL}/api/customers`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${BILLING_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId, email, name })
    });
    if (!response.ok) {
        throw new Error(`Failed to create billing customer: ${response.status} ${response.statusText} ${await response.text()}`);
    }
    const json = await response.json();
    const parseResult = Customer.safeParse(json);
    if (!parseResult.success) {
        throw new Error(`Failed to parse billing customer: ${JSON.stringify(parseResult.error)}`);
    }
    return parseResult.data as z.infer<typeof Customer>;
}

export async function createStripePricingTableSession(customerId: string): Promise<z.infer<typeof PricingTableSession>> {
    const response = await fetch(`${BILLING_API_URL}/api/customers/${customerId}/stripe-pricing-table-session`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${BILLING_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`Failed to get stripe pricing table client secret: ${response.status} ${response.statusText} ${await response.text()}`);
    }
    const json = await response.json();
    const parseResult = PricingTableSession.safeParse(json);
    if (!parseResult.success) {
        throw new Error(`Failed to parse stripe pricing table session: ${JSON.stringify(parseResult.error)}`);
    }
    console.log('stripe pricing table session', json);
    return parseResult.data as z.infer<typeof PricingTableSession>;
}

export async function syncWithStripe(customerId: string): Promise<void> {
    const response = await fetch(`${BILLING_API_URL}/api/customers/${customerId}/sync-with-stripe`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${BILLING_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`Failed to sync with stripe: ${response.status} ${response.statusText} ${await response.text()}`);
    }
}

export async function requireBillingCustomer(): Promise<WithStringId<z.infer<typeof Customer>>> {
    if (!USE_BILLING) {
        return GUEST_CUSTOMER;
    }

    // fetch auth0 user
    const { user } = await getSession() || {};
    if (!user) {
        throw new Error('User not authenticated');
    }

    // check if user exists in database. If not, create a new user
    const dbUser = await usersCollection.findOneAndUpdate({
        auth0Id: user.sub
    }, {
        $setOnInsert: {
            auth0Id: user.sub,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
    }, {
        upsert: true,
        returnDocument: 'after'
    });
    if (!dbUser) {
        throw new Error('User not found');
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

export async function requireActiveBillingSubscription(): Promise<WithStringId<z.infer<typeof Customer>>> {
    if (!USE_BILLING) {
        return GUEST_CUSTOMER;
    }

    const billingCustomer = await requireBillingCustomer();
    
    if (!billingCustomer?.subscriptionActive) {
        redirect('/billing/checkout');
    }
    return billingCustomer;
}