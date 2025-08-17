import { WithStringId } from './types/types';
import { z } from 'zod';
import { Customer, AuthorizeRequest, AuthorizeResponse, LogUsageRequest, UsageResponse, CustomerPortalSessionResponse, PricesResponse, UpdateSubscriptionPlanRequest, UpdateSubscriptionPlanResponse, ModelsResponse, UsageItem } from './types/billing_types';
import { ObjectId } from 'mongodb';
import { projectsCollection, usersCollection } from './mongodb';
import { redirect } from 'next/navigation';
import { getUserFromSessionId, requireAuth } from './auth';
import { USE_BILLING } from './feature_flags';

const BILLING_API_URL = process.env.BILLING_API_URL || 'http://billing';
const BILLING_API_KEY = process.env.BILLING_API_KEY || 'test';

const GUEST_BILLING_CUSTOMER = {
    _id: "guest-user",
    userId: "guest-user",
    name: "Guest",
    email: "guest@rowboatlabs.com",
    stripeCustomerId: "guest",
    stripeSubscriptionId: "test",
    subscriptionPlan: "free" as const,
    subscriptionStatus: "active" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

export class UsageTracker{
    private items: z.infer<typeof UsageItem>[] = [];

    track(item: z.infer<typeof UsageItem>) {
        this.items.push(item);
    }

    flush(): z.infer<typeof UsageItem>[] {
        const items = this.items;
        this.items = [];
        return items;
    }
}

export async function getCustomerForUserId(userId: string): Promise<WithStringId<z.infer<typeof Customer>> | null> {
    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
    if (!user) {
        throw new Error("User not found");
    }
    if (!user.billingCustomerId) {
        return null;
    }
    return await getBillingCustomer(user.billingCustomerId);
}

export async function getCustomerIdForProject(projectId: string): Promise<string> {
    const project = await projectsCollection.findOne({ _id: projectId });
    if (!project) {
        throw new Error("Project not found");
    }
    const customer = await getCustomerForUserId(project.createdByUserId);
    if (!customer) {
        throw new Error("User has no billing customer id");
    }
    return customer._id;
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
    return parseResult.data;
}

async function createBillingCustomer(userId: string, email: string): Promise<WithStringId<z.infer<typeof Customer>>> {
    const response = await fetch(`${BILLING_API_URL}/api/customers`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${BILLING_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId, email })
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

export async function authorize(customerId: string, request: z.infer<typeof AuthorizeRequest>): Promise<z.infer<typeof AuthorizeResponse>> {
    const response = await fetch(`${BILLING_API_URL}/api/customers/${customerId}/authorize`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${BILLING_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
    });
    if (!response.ok) {
        throw new Error(`Failed to authorize billing: ${response.status} ${response.statusText} ${await response.text()}`);
    }
    const json = await response.json();
    const parseResult = AuthorizeResponse.safeParse(json);
    if (!parseResult.success) {
        throw new Error(`Failed to parse authorize billing response: ${JSON.stringify(parseResult.error)}`);
    }
    return parseResult.data as z.infer<typeof AuthorizeResponse>;
}

export async function logUsage(customerId: string, request: z.infer<typeof LogUsageRequest>) {
    console.log(`logging billing usage for customer ${customerId}`, JSON.stringify(request));
    const response = await fetch(`${BILLING_API_URL}/api/customers/${customerId}/log-usage`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${BILLING_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
    });
    if (!response.ok) {
        throw new Error(`Failed to log usage: ${response.status} ${response.statusText} ${await response.text()}`);
    }
}

export async function getUsage(customerId: string): Promise<z.infer<typeof UsageResponse>> {
    const response = await fetch(`${BILLING_API_URL}/api/customers/${customerId}/usage`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${BILLING_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`Failed to get usage: ${response.status} ${response.statusText} ${await response.text()}`);
    }
    const json = await response.json();
    const parseResult = UsageResponse.safeParse(json);
    if (!parseResult.success) {
        throw new Error(`Failed to parse usage response: ${JSON.stringify(parseResult.error)}`);
    }
    return parseResult.data as z.infer<typeof UsageResponse>;
}

export async function createCustomerPortalSession(customerId: string, returnUrl: string): Promise<string> {
    const response = await fetch(`${BILLING_API_URL}/api/customers/${customerId}/customer-portal-session`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${BILLING_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ returnUrl })
    });
    if (!response.ok) {
        throw new Error(`Failed to get customer portal url: ${response.status} ${response.statusText} ${await response.text()}`);
    }
    const json = await response.json();
    const parseResult = CustomerPortalSessionResponse.safeParse(json);
    if (!parseResult.success) {
        throw new Error(`Failed to parse customer portal session response: ${JSON.stringify(parseResult.error)}`);
    }
    return parseResult.data.url;
}

export async function getPrices(): Promise<z.infer<typeof PricesResponse>> {
    const response = await fetch(`${BILLING_API_URL}/api/prices`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${BILLING_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`Failed to get prices: ${response.status} ${response.statusText} ${await response.text()}`);
    }
    const json = await response.json();
    const parseResult = PricesResponse.safeParse(json);
    if (!parseResult.success) {
        throw new Error(`Failed to parse prices response: ${JSON.stringify(parseResult.error)}`);
    }
    return parseResult.data as z.infer<typeof PricesResponse>;
}

export async function updateSubscriptionPlan(customerId: string, request: z.infer<typeof UpdateSubscriptionPlanRequest>): Promise<string> {
    const response = await fetch(`${BILLING_API_URL}/api/customers/${customerId}/update-sub-session`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${BILLING_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
    });
    if (!response.ok) {
        throw new Error(`Failed to update subscription plan: ${response.status} ${response.statusText} ${await response.text()}`);
    }
    const json = await response.json();
    const parseResult = UpdateSubscriptionPlanResponse.safeParse(json);
    if (!parseResult.success) {
        throw new Error(`Failed to parse update subscription plan response: ${JSON.stringify(parseResult.error)}`);
    }
    return parseResult.data.url;
}

export async function getEligibleModels(customerId: string): Promise<z.infer<typeof ModelsResponse>> {
    const response = await fetch(`${BILLING_API_URL}/api/customers/${customerId}/models`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${BILLING_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`Failed to get eligible models: ${response.status} ${response.statusText} ${await response.text()}`);
    }
    const json = await response.json();
    const parseResult = ModelsResponse.safeParse(json);
    if (!parseResult.success) {
        throw new Error(`Failed to parse eligible models response: ${JSON.stringify(parseResult.error)}`);
    }
    return parseResult.data as z.infer<typeof ModelsResponse>;
}

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
    const user = await requireAuth();

    if (!USE_BILLING) {
        return {
            ...GUEST_BILLING_CUSTOMER,
            userId: user._id,
        };
    }

    // if user does not have an email, redirect to onboarding
    if (!user.email) {
        redirect('/onboarding');
    }

    // fetch or create customer
    let customer: WithStringId<z.infer<typeof Customer>> | null;
    if (user.billingCustomerId) {
        customer = await getBillingCustomer(user.billingCustomerId);
    } else {
        customer = await createBillingCustomer(user._id, user.email);
        console.log("created billing customer", JSON.stringify({ userId: user._id, customer }));

        // update customer id in db
        await usersCollection.updateOne({
            _id: new ObjectId(user._id),
        }, {
            $set: {
                billingCustomerId: customer._id,
                updatedAt: new Date().toISOString(),
            }
        });
    }
    if (!customer) {
        throw new Error("Failed to fetch or create billing customer");
    }

    return customer;
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

    if (USE_BILLING && billingCustomer.subscriptionStatus !== "active" && billingCustomer.subscriptionStatus !== "past_due") {
        redirect('/billing');
    }
    return billingCustomer;
}

