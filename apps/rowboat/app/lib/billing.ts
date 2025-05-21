import { USE_BILLING } from '@/app/lib/feature_flags'
import { WithStringId } from './types/types';
import { z } from 'zod';
import { Customer, PricingTableResponse, AuthorizeRequest, AuthorizeResponse, LogUsageRequest } from './types/billing_types';

const BILLING_API_URL = process.env.BILLING_API_URL || 'http://billing';
const BILLING_API_KEY = process.env.BILLING_API_KEY || 'test';

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

export async function createStripePricingTableSession(customerId: string): Promise<z.infer<typeof PricingTableResponse>> {
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
    const parseResult = PricingTableResponse.safeParse(json);
    if (!parseResult.success) {
        throw new Error(`Failed to parse stripe pricing table session: ${JSON.stringify(parseResult.error)}`);
    }
    console.log('stripe pricing table session', json);
    return parseResult.data as z.infer<typeof PricingTableResponse>;
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
    if (!USE_BILLING) {
        return { success: true };
    }

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
    if (!USE_BILLING) {
        return;
    }

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