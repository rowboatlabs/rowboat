"use client";
import { PricingTableSession } from '@/app/lib/types/billing_types';
import * as React from 'react';

// If using TypeScript, add the following snippet to your file as well.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'stripe-pricing-table': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export function PricingPage({ session }: { session: z.infer<typeof PricingTableSession> }) {
  // Paste the stripe-pricing-table snippet in your React component
  return (
    <stripe-pricing-table
      pricing-table-id={session.pricingTableId}
      publishable-key={session.publishableKey}
      customer-session-client-secret={session.clientSecret}
    >
    </stripe-pricing-table>
  );
}