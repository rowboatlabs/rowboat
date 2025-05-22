"use client";
import { PricingTableResponse } from '@/app/lib/types/billing_types';
import { z } from 'zod';
import * as React from 'react';
import { tokens } from "@/app/styles/design-tokens";
import { SectionHeading } from "@/components/ui/section-heading";
import { HorizontalDivider } from "@/components/ui/horizontal-divider";
import clsx from 'clsx';

// If using TypeScript, add the following snippet to your file as well.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'stripe-pricing-table': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export function PricingPage({ response }: { response: z.infer<typeof PricingTableResponse> }) {
  return (
    <div className="max-w-7xl mx-auto px-8 py-8 space-y-8">
      <div className="px-4">
        <h1 className={clsx(
          tokens.typography.sizes.xl,
          tokens.typography.weights.semibold,
          tokens.colors.light.text.primary,
          tokens.colors.dark.text.primary
        )}>
          Choose a plan
        </h1>
        <p className={clsx(
          tokens.typography.sizes.lg,
          tokens.colors.light.text.secondary,
          tokens.colors.dark.text.secondary,
          "mt-2"
        )}>
          Get started with Rowboat
        </p>
      </div>

      <section className="card">
        <div className="px-4 pt-4 pb-6">
          <SectionHeading>
            Available plans
          </SectionHeading>
        </div>
        <HorizontalDivider />
        <div className="p-6">
          <stripe-pricing-table
            pricing-table-id={response.pricingTableId}
            publishable-key={response.publishableKey}
            customer-session-client-secret={response.clientSecret}
          >
          </stripe-pricing-table>
        </div>
      </section>
    </div>
  );
}