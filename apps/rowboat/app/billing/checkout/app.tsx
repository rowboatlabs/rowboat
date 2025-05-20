"use client";
import { PricingTableResponse } from '@/app/lib/types/billing_types';
import { z } from 'zod';
import * as React from 'react';

// If using TypeScript, add the following snippet to your file as well.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'stripe-pricing-table': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export function PricingPage({ response }: { response: z.infer<typeof PricingTableResponse> }) {
  // Paste the stripe-pricing-table snippet in your React component
  return (
    <stripe-pricing-table
      pricing-table-id={response.pricingTableId}
      publishable-key={response.publishableKey}
      customer-session-client-secret={response.clientSecret}
    >
    </stripe-pricing-table>
  );
}