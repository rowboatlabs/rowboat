'use client';

import { Progress, Badge } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { Label } from "@/app/lib/components/label";
import { Customer, UsageResponse, UsageType } from "@/app/lib/types/billing_types";
import { z } from "zod";
import { tokens } from "@/app/styles/design-tokens";
import { SectionHeading } from "@/components/ui/section-heading";
import { HorizontalDivider } from "@/components/ui/horizontal-divider";
import { WithStringId } from "@/app/lib/types/types";
import clsx from 'clsx';
import { getCustomerPortalUrl } from "../actions/billing_actions";

const planDetails = {
    free: {
        name: "Free Plan",
        color: "default"
    },
    basic: {
        name: "Basic Plan",
        color: "primary"
    },
    pro: {
        name: "Pro Plan",
        color: "secondary"
    }
};

interface BillingPageProps {
    customer: WithStringId<z.infer<typeof Customer>>;
    usage: z.infer<typeof UsageResponse>;
}

export function BillingPage({ customer, usage }: BillingPageProps) {
    const plan = customer.subscriptionPlan || "free";
    const isActive = customer.subscriptionActive || false;
    const planInfo = planDetails[plan];

    async function handleManageSubscription() {
        const url = await getCustomerPortalUrl(window.location.href);
        window.location.href = url;
    }

    return (
        <div className="max-w-4xl mx-auto px-8 py-8 space-y-8">
            <div className="px-4">
                <h1 className={clsx(
                    tokens.typography.sizes.xl,
                    tokens.typography.weights.semibold,
                    tokens.colors.light.text.primary,
                    tokens.colors.dark.text.primary
                )}>
                    Billing
                </h1>
            </div>

            {/* Subscription Status Panel */}
            <section className="card">
                <div className="px-4 pt-4 pb-6">
                    <SectionHeading>
                        Current Plan
                    </SectionHeading>
                </div>
                <HorizontalDivider />
                <div className="p-6 space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <h3 className={clsx(
                                    tokens.typography.sizes.lg,
                                    tokens.typography.weights.semibold,
                                    tokens.colors.light.text.primary,
                                    tokens.colors.dark.text.primary
                                )}>
                                    {planInfo.name}
                                </h3>
                                <Badge 
                                    color={isActive ? "success" : "warning"}
                                    variant="flat"
                                    className="text-xs"
                                >
                                    {isActive ? "Active" : "Inactive"}
                                </Badge>
                            </div>
                        </div>
                        <form action={handleManageSubscription}>
                            <Button 
                                variant="primary"
                                size="md"
                                type="submit"
                            >
                                Manage Subscription
                            </Button>
                        </form>
                    </div>
                </div>
            </section>

            {/* Usage Metrics Panel */}
            <section className="card">
                <div className="px-4 pt-4 pb-6">
                    <SectionHeading>
                        Usage Metrics
                    </SectionHeading>
                </div>
                <HorizontalDivider />
                <div className="p-6 space-y-6">
                    {Object.entries(usage.usage).map(([type, { usage: used, total }]) => {
                        const usageType = type as z.infer<typeof UsageType>;
                        const percentage = Math.min((used / total) * 100, 100);
                        const isOverLimit = used > total;

                        return (
                            <div key={type} className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <div className="space-y-1">
                                        <Label label={type.replace(/_/g, ' ')} />
                                        <p className={clsx(
                                            tokens.typography.sizes.sm,
                                            tokens.colors.light.text.secondary,
                                            tokens.colors.dark.text.secondary
                                        )}>
                                            {used.toLocaleString()} / {total.toLocaleString()}
                                        </p>
                                    </div>
                                    {isOverLimit && (
                                        <Badge color="danger" variant="flat">
                                            Over Limit
                                        </Badge>
                                    )}
                                </div>
                                <Progress 
                                    value={percentage}
                                    color={isOverLimit ? "danger" : "primary"}
                                    className="h-2"
                                    aria-label={`${type} usage`}
                                />
                            </div>
                        );
                    })}
                </div>
            </section>
        </div>
    );
} 