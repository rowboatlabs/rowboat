import { z } from 'zod';
import { generateObject } from 'ai';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { createProvider } from '../models/models.js';
import {
    getDefaultModelAndProvider,
    getKgModel,
    resolveProviderConfig,
} from '../models/defaults.js';
import { captureLlmUsage } from '../analytics/usage.js';
import type { GmailThreadSnapshot } from './sync_gmail.js';

let cachedUserEmail: string | null = null;

export async function getUserEmail(auth: OAuth2Client): Promise<string | null> {
    if (cachedUserEmail) return cachedUserEmail;
    try {
        const gmailClient = google.gmail({ version: 'v1', auth });
        const res = await gmailClient.users.getProfile({ userId: 'me' });
        if (res.data.emailAddress) {
            cachedUserEmail = res.data.emailAddress.toLowerCase();
            return cachedUserEmail;
        }
    } catch (err) {
        console.warn('[Email classifier] getProfile failed:', err);
    }
    return null;
}

export interface Classification {
    importance: 'important' | 'other';
    summary?: string;
}

const ClassificationSchema = z.object({
    importance: z.enum(['important', 'other']).describe('important = real correspondence, action-required, or content worth referencing later. other = newsletters, marketing, automated notifications, transactional receipts, cold outreach.'),
    summary: z.string().optional().describe('One or two sentences capturing what the thread is about and any implied action. Required when importance is important. Omit when other.'),
});

const SYSTEM_PROMPT = `You classify a Gmail thread for a personal inbox view.

Decide if the thread is "important" or "other":

- important: real human correspondence the user is part of (customer, investor, team, vendor, candidate); a time-sensitive notification; a message that needs a response from the user; anything worth referencing later (contracts, pricing, deadlines, decisions).
- other: newsletters, industry digests, marketing or promotional, product tips from vendors, automated notifications (verifications, recording uploads, platform policy updates), transactional confirmations (payment receipts, GST/tax filings, salary disbursements), unsolicited cold outreach.

When the thread is important, write a 1-2 sentence summary that captures the gist and any action implied (e.g. "Customer requesting a demo next Tuesday; needs a calendar link." or "Investor following up on Q3 metrics; reply expected."). Omit the summary when the thread is "other".

Be decisive — pick exactly one label. Do not hedge.`;

function userReplied(snapshot: GmailThreadSnapshot, userEmail: string | null): boolean {
    if (!userEmail) return false;
    const needle = userEmail.toLowerCase();
    return snapshot.messages.some(m => (m.from || '').toLowerCase().includes(needle));
}

function buildPrompt(snapshot: GmailThreadSnapshot): string {
    const lines: string[] = [];
    lines.push(`Subject: ${snapshot.subject || '(no subject)'}`);
    lines.push(`Message count: ${snapshot.messages.length}`);
    lines.push('');
    const latest = snapshot.messages[snapshot.messages.length - 1];
    if (latest) {
        lines.push(`Latest message:`);
        lines.push(`  From: ${latest.from || 'unknown'}`);
        if (latest.to) lines.push(`  To: ${latest.to}`);
        if (latest.date) lines.push(`  Date: ${latest.date}`);
        lines.push('');
        const snippet = (latest.body || '').replace(/\s+/g, ' ').slice(0, 1200).trim();
        lines.push(`  Body:`);
        lines.push(`  ${snippet}`);
    }
    return lines.join('\n');
}

export async function classifyThread(
    snapshot: GmailThreadSnapshot,
    userEmail: string | null,
): Promise<Classification> {
    if (userReplied(snapshot, userEmail)) {
        return { importance: 'important' };
    }

    try {
        const modelId = await getKgModel();
        const { provider } = await getDefaultModelAndProvider();
        const config = await resolveProviderConfig(provider);
        const model = createProvider(config).languageModel(modelId);

        const result = await generateObject({
            model,
            system: SYSTEM_PROMPT,
            prompt: buildPrompt(snapshot),
            schema: ClassificationSchema,
        });

        captureLlmUsage({
            useCase: 'knowledge_sync',
            subUseCase: 'email_classifier',
            model: modelId,
            provider,
            usage: result.usage,
        });

        const out: Classification = { importance: result.object.importance };
        if (result.object.importance === 'important' && result.object.summary) {
            out.summary = result.object.summary;
        }
        return out;
    } catch (err) {
        console.warn(`[Email classifier] LLM call failed for thread ${snapshot.threadId}:`, err);
        return { importance: 'important' };
    }
}
