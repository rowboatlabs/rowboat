import { z } from 'zod';
import { WithId } from 'mongodb';

export const TwilioConfigParams = z.object({
    phone_number: z.string(),
    account_sid: z.string(),
    auth_token: z.string(),
    label: z.string(),
    project_id: z.string(),
    workflow_id: z.string(),
});

export const TwilioConfig = TwilioConfigParams.extend({
    createdAt: z.date(),
    status: z.enum(['active', 'deleted']),
});

export type TwilioConfigParams = z.infer<typeof TwilioConfigParams>;
export type TwilioConfig = WithId<z.infer<typeof TwilioConfig>>;

export interface TwilioConfigResponse {
    success: boolean;
    error?: string;
}

export interface InboundConfigResponse {
    status: 'configured' | 'reconfigured';
    phone_number: string;
    workflow_id: string;
    previous_webhook?: string;
    error?: string;
}