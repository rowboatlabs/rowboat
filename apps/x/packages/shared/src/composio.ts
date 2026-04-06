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

export type ToolkitCategory = 'communication' | 'productivity' | 'development' | 'crm' | 'social' | 'storage' | 'support';

export interface CuratedToolkit {
    slug: string;
    displayName: string;
    category: ToolkitCategory;
}

export const CURATED_TOOLKITS: CuratedToolkit[] = [
    { slug: 'airtable', displayName: 'Airtable', category: 'productivity' },
    { slug: 'asana', displayName: 'Asana', category: 'productivity' },
    { slug: 'cal', displayName: 'Cal.com', category: 'productivity' },
    { slug: 'calendly', displayName: 'Calendly', category: 'productivity' },
    { slug: 'dropbox', displayName: 'Dropbox', category: 'storage' },
    { slug: 'github', displayName: 'GitHub', category: 'development' },
    { slug: 'gmail', displayName: 'Gmail', category: 'communication' },
    { slug: 'googlecalendar', displayName: 'Google Calendar', category: 'productivity' },
    { slug: 'googledocs', displayName: 'Google Docs', category: 'productivity' },
    { slug: 'googledrive', displayName: 'Google Drive', category: 'storage' },
    { slug: 'googlesheets', displayName: 'Google Sheets', category: 'productivity' },
    { slug: 'hubspot', displayName: 'HubSpot', category: 'crm' },
    { slug: 'intercom', displayName: 'Intercom', category: 'support' },
    { slug: 'jira', displayName: 'Jira', category: 'development' },
    { slug: 'linear', displayName: 'Linear', category: 'development' },
    { slug: 'linkedin', displayName: 'LinkedIn', category: 'social' },
    { slug: 'microsoft_outlook', displayName: 'Microsoft Outlook', category: 'communication' },
    { slug: 'microsoft_teams', displayName: 'Microsoft Teams', category: 'communication' },
    { slug: 'notion', displayName: 'Notion', category: 'productivity' },
    { slug: 'onedrive', displayName: 'OneDrive', category: 'storage' },
    { slug: 'reddit', displayName: 'Reddit', category: 'social' },
    { slug: 'salesforce', displayName: 'Salesforce', category: 'crm' },
    { slug: 'slack', displayName: 'Slack', category: 'communication' },
    { slug: 'trello', displayName: 'Trello', category: 'productivity' },
    { slug: 'twitter', displayName: 'X', category: 'social' },
    { slug: 'zendesk', displayName: 'Zendesk', category: 'support' },
];

/** Slug → display-name lookup. */
export const COMPOSIO_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
    CURATED_TOOLKITS.map(t => [t.slug, t.displayName])
);

/** Set of curated slugs for fast membership checks. */
export const CURATED_TOOLKIT_SLUGS = new Set(CURATED_TOOLKITS.map(t => t.slug));
