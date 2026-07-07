import { z } from 'zod';

/**
 * Zod schemas for Composio IPC responses.
 * Defined here in shared so both ipc.ts and core/composio/types.ts can reference them.
 */
export const ZToolkitMeta = z.object({
    description: z.string(),
    logo: z.string(),
    tools_count: z.number(),
    triggers_count: z.number(),
});

export const ZToolkitItem = z.object({
    slug: z.string(),
    name: z.string(),
    meta: ZToolkitMeta,
    no_auth: z.boolean().optional(),
    auth_schemes: z.array(z.string()).optional(),
    composio_managed_auth_schemes: z.array(z.string()).optional(),
});

export const ZListToolkitsResponse = z.object({
    items: z.array(ZToolkitItem),
    nextCursor: z.string().nullable(),
    totalItems: z.number(),
});

/**
 * Curated Composio toolkits available to Rowboat users.
 * Single source of truth for slugs, display names, and categories.
 * Sorted by slug (ASC) for maintainability.
 */

export type ToolkitCategory = 'communication' | 'productivity' | 'development' | 'crm' | 'social' | 'storage' | 'support' | 'design' | 'marketing' | 'finance';

export interface CuratedToolkit {
    slug: string;
    displayName: string;
    category: ToolkitCategory;
}

export const CURATED_TOOLKITS: CuratedToolkit[] = [
    { slug: 'airtable', displayName: 'Airtable', category: 'productivity' },
    { slug: 'asana', displayName: 'Asana', category: 'productivity' },
    { slug: 'attio', displayName: 'Attio', category: 'crm' },
    { slug: 'basecamp', displayName: 'Basecamp', category: 'productivity' },
    { slug: 'bitbucket', displayName: 'Bitbucket', category: 'development' },
    { slug: 'box', displayName: 'Box', category: 'storage' },
    { slug: 'cal', displayName: 'Cal.com', category: 'productivity' },
    { slug: 'calendly', displayName: 'Calendly', category: 'productivity' },
    { slug: 'canva', displayName: 'Canva', category: 'design' },
    { slug: 'clickup', displayName: 'ClickUp', category: 'productivity' },
    { slug: 'confluence', displayName: 'Confluence', category: 'productivity' },
    { slug: 'discord', displayName: 'Discord', category: 'communication' },
    { slug: 'dropbox', displayName: 'Dropbox', category: 'storage' },
    { slug: 'eventbrite', displayName: 'Eventbrite', category: 'marketing' },
    { slug: 'excel', displayName: 'Microsoft Excel', category: 'productivity' },
    { slug: 'facebook', displayName: 'Facebook', category: 'social' },
    { slug: 'figma', displayName: 'Figma', category: 'design' },
    { slug: 'github', displayName: 'GitHub', category: 'development' },
    { slug: 'gitlab', displayName: 'GitLab', category: 'development' },
    { slug: 'gmail', displayName: 'Gmail', category: 'communication' },
    { slug: 'google_analytics', displayName: 'Google Analytics', category: 'marketing' },
    { slug: 'google_maps', displayName: 'Google Maps', category: 'productivity' },
    { slug: 'google_search_console', displayName: 'Google Search Console', category: 'marketing' },
    { slug: 'googleads', displayName: 'Google Ads', category: 'marketing' },
    { slug: 'googlebigquery', displayName: 'Google BigQuery', category: 'development' },
    { slug: 'googlecalendar', displayName: 'Google Calendar', category: 'productivity' },
    { slug: 'googledocs', displayName: 'Google Docs', category: 'productivity' },
    { slug: 'googledrive', displayName: 'Google Drive', category: 'storage' },
    { slug: 'googlemeet', displayName: 'Google Meet', category: 'communication' },
    { slug: 'googlephotos', displayName: 'Google Photos', category: 'storage' },
    { slug: 'googlesheets', displayName: 'Google Sheets', category: 'productivity' },
    { slug: 'googleslides', displayName: 'Google Slides', category: 'productivity' },
    { slug: 'googletasks', displayName: 'Google Tasks', category: 'productivity' },
    { slug: 'hubspot', displayName: 'HubSpot', category: 'crm' },
    { slug: 'instagram', displayName: 'Instagram', category: 'social' },
    { slug: 'intercom', displayName: 'Intercom', category: 'support' },
    { slug: 'jira', displayName: 'Jira', category: 'development' },
    { slug: 'linear', displayName: 'Linear', category: 'development' },
    { slug: 'linkedin', displayName: 'LinkedIn', category: 'social' },
    { slug: 'mailchimp', displayName: 'Mailchimp', category: 'marketing' },
    { slug: 'microsoft_teams', displayName: 'Microsoft Teams', category: 'communication' },
    { slug: 'miro', displayName: 'Miro', category: 'productivity' },
    { slug: 'monday', displayName: 'monday.com', category: 'productivity' },
    { slug: 'notion', displayName: 'Notion', category: 'productivity' },
    { slug: 'one_drive', displayName: 'OneDrive', category: 'storage' },
    { slug: 'outlook', displayName: 'Microsoft Outlook', category: 'communication' },
    { slug: 'pagerduty', displayName: 'PagerDuty', category: 'development' },
    { slug: 'productboard', displayName: 'Productboard', category: 'productivity' },
    { slug: 'quickbooks', displayName: 'QuickBooks', category: 'finance' },
    { slug: 'reddit', displayName: 'Reddit', category: 'social' },
    { slug: 'reddit_ads', displayName: 'Reddit Ads', category: 'marketing' },
    { slug: 'salesforce', displayName: 'Salesforce', category: 'crm' },
    { slug: 'sentry', displayName: 'Sentry', category: 'development' },
    { slug: 'share_point', displayName: 'SharePoint', category: 'storage' },
    { slug: 'slack', displayName: 'Slack', category: 'communication' },
    { slug: 'square', displayName: 'Square', category: 'finance' },
    { slug: 'stripe', displayName: 'Stripe', category: 'finance' },
    { slug: 'supabase', displayName: 'Supabase', category: 'development' },
    { slug: 'todoist', displayName: 'Todoist', category: 'productivity' },
    { slug: 'trello', displayName: 'Trello', category: 'productivity' },
    { slug: 'twitter', displayName: 'X', category: 'social' },
    { slug: 'typeform', displayName: 'Typeform', category: 'productivity' },
    { slug: 'whatsapp', displayName: 'WhatsApp', category: 'communication' },
    { slug: 'wrike', displayName: 'Wrike', category: 'productivity' },
    { slug: 'youtube', displayName: 'YouTube', category: 'social' },
    { slug: 'zendesk', displayName: 'Zendesk', category: 'support' },
    { slug: 'zoom', displayName: 'Zoom', category: 'communication' },
];

/** Slug → display-name lookup. */
export const COMPOSIO_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
    CURATED_TOOLKITS.map(t => [t.slug, t.displayName])
);

/** Set of curated slugs for fast membership checks. */
export const CURATED_TOOLKIT_SLUGS = new Set(CURATED_TOOLKITS.map(t => t.slug));
