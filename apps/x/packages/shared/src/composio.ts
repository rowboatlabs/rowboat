/**
 * Curated Composio toolkits available to Rowboat users.
 * Single source of truth for slugs, display names, and categories.
 */

export type ToolkitCategory = 'communication' | 'productivity' | 'development' | 'crm' | 'social' | 'storage' | 'support';

export interface CuratedToolkit {
    slug: string;
    displayName: string;
    category: ToolkitCategory;
}

export const CURATED_TOOLKITS: CuratedToolkit[] = [
    // Communication
    { slug: 'gmail', displayName: 'Gmail', category: 'communication' },
    { slug: 'slack', displayName: 'Slack', category: 'communication' },
    { slug: 'microsoft_outlook', displayName: 'Microsoft Outlook', category: 'communication' },
    { slug: 'microsoft_teams', displayName: 'Microsoft Teams', category: 'communication' },

    // Productivity
    { slug: 'googlecalendar', displayName: 'Google Calendar', category: 'productivity' },
    { slug: 'googledocs', displayName: 'Google Docs', category: 'productivity' },
    { slug: 'googlesheets', displayName: 'Google Sheets', category: 'productivity' },
    { slug: 'notion', displayName: 'Notion', category: 'productivity' },
    { slug: 'airtable', displayName: 'Airtable', category: 'productivity' },
    { slug: 'calendly', displayName: 'Calendly', category: 'productivity' },
    { slug: 'cal', displayName: 'Cal.com', category: 'productivity' },

    // Storage
    { slug: 'googledrive', displayName: 'Google Drive', category: 'storage' },
    { slug: 'dropbox', displayName: 'Dropbox', category: 'storage' },
    { slug: 'onedrive', displayName: 'OneDrive', category: 'storage' },

    // Development
    { slug: 'github', displayName: 'GitHub', category: 'development' },
    { slug: 'linear', displayName: 'Linear', category: 'development' },
    { slug: 'jira', displayName: 'Jira', category: 'development' },

    // Project Management
    { slug: 'asana', displayName: 'Asana', category: 'productivity' },
    { slug: 'trello', displayName: 'Trello', category: 'productivity' },

    // CRM & Sales
    { slug: 'hubspot', displayName: 'HubSpot', category: 'crm' },
    { slug: 'salesforce', displayName: 'Salesforce', category: 'crm' },

    // Social
    { slug: 'linkedin', displayName: 'LinkedIn', category: 'social' },
    { slug: 'twitter', displayName: 'X', category: 'social' },
    { slug: 'reddit', displayName: 'Reddit', category: 'social' },

    // Support
    { slug: 'intercom', displayName: 'Intercom', category: 'support' },
    { slug: 'zendesk', displayName: 'Zendesk', category: 'support' },
];

/** Slug → display-name lookup. */
export const COMPOSIO_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
    CURATED_TOOLKITS.map(t => [t.slug, t.displayName])
);

/** Set of curated slugs for fast membership checks. */
export const CURATED_TOOLKIT_SLUGS = new Set(CURATED_TOOLKITS.map(t => t.slug));
