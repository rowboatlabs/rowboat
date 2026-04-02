/**
 * Curated list of Composio toolkits available to Rowboat users.
 * Only these toolkits are shown in the UI and discoverable via chat.
 * Exact slugs match Composio API naming convention.
 *
 * Display names come from @x/shared/composio (single source of truth).
 */

import { COMPOSIO_DISPLAY_NAMES } from "@x/shared/dist/composio.js";

export { COMPOSIO_DISPLAY_NAMES } from "@x/shared/dist/composio.js";

export type ToolkitCategory = 'communication' | 'productivity' | 'development' | 'crm' | 'social' | 'storage' | 'support';

export interface CuratedToolkit {
    slug: string;
    displayName: string;
    category: ToolkitCategory;
}

const toolkit = (slug: string, category: ToolkitCategory): CuratedToolkit => ({
    slug,
    displayName: COMPOSIO_DISPLAY_NAMES[slug] ?? slug,
    category,
});

export const CURATED_TOOLKITS: CuratedToolkit[] = [
    // Communication
    toolkit('gmail', 'communication'),
    toolkit('slack', 'communication'),
    toolkit('microsoft_outlook', 'communication'),
    toolkit('microsoft_teams', 'communication'),

    // Productivity
    toolkit('googlecalendar', 'productivity'),
    toolkit('googledocs', 'productivity'),
    toolkit('googlesheets', 'productivity'),
    toolkit('notion', 'productivity'),
    toolkit('airtable', 'productivity'),
    toolkit('calendly', 'productivity'),
    toolkit('cal', 'productivity'),

    // Storage
    toolkit('googledrive', 'storage'),
    toolkit('dropbox', 'storage'),
    toolkit('onedrive', 'storage'),

    // Development
    toolkit('github', 'development'),
    toolkit('linear', 'development'),
    toolkit('jira', 'development'),

    // Project Management
    toolkit('asana', 'productivity'),
    toolkit('trello', 'productivity'),

    // CRM & Sales
    toolkit('hubspot', 'crm'),
    toolkit('salesforce', 'crm'),

    // Social
    toolkit('linkedin', 'social'),
    toolkit('twitter', 'social'),
    toolkit('reddit', 'social'),

    // Support
    toolkit('intercom', 'support'),
    toolkit('zendesk', 'support'),
];

/**
 * Set of curated toolkit slugs for fast lookup.
 */
export const CURATED_TOOLKIT_SLUGS = new Set(CURATED_TOOLKITS.map(t => t.slug));
