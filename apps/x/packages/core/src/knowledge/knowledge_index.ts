import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';

const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');

/**
 * Index entry for a person note
 */
interface PersonEntry {
    file: string;
    name: string;
    email?: string;
    aliases: string[];
    organization?: string;
    role?: string;
}

/**
 * Index entry for an organization note
 */
interface OrganizationEntry {
    file: string;
    name: string;
    domain?: string;
    aliases: string[];
}

/**
 * Index entry for a project note
 */
interface ProjectEntry {
    file: string;
    name: string;
    status?: string;
    aliases: string[];
}

/**
 * Index entry for a topic note
 */
interface TopicEntry {
    file: string;
    name: string;
    keywords: string[];
    aliases: string[];
}

/**
 * Index entry for notes in non-standard folders (generic)
 */
interface OtherEntry {
    file: string;
    name: string;
    folder: string;
    aliases: string[];
}

/**
 * The complete knowledge index
 */
export interface KnowledgeIndex {
    people: PersonEntry[];
    organizations: OrganizationEntry[];
    projects: ProjectEntry[];
    topics: TopicEntry[];
    other: OtherEntry[];
    buildTime: string;
}

/**
 * Extract a field value from markdown content
 * Looks for patterns like **Field:** value or **Field:** [[Link]]
 */
function extractField(content: string, fieldName: string): string | undefined {
    // Match **Field:** value (handles [[links]] and plain text)
    const pattern = new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+?)(?:\\n|$)`, 'i');
    const match = content.match(pattern);
    if (match) {
        let value = match[1].trim();
        // Extract text from [[link]] if present
        const linkMatch = value.match(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/);
        if (linkMatch) {
            value = linkMatch[1];
        }
        return value || undefined;
    }
    return undefined;
}

/**
 * Extract comma-separated values from a field
 */
function extractList(content: string, fieldName: string): string[] {
    const value = extractField(content, fieldName);
    if (!value) return [];
    return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Extract the title (first H1) from markdown content
 */
function extractTitle(content: string): string {
    const match = content.match(/^#\s+(.+?)$/m);
    return match ? match[1].trim() : '';
}

/**
 * Parse a person note and extract index data
 */
function parsePersonNote(filePath: string, content: string): PersonEntry {
    const name = extractTitle(content);
    const relativePath = path.relative(KNOWLEDGE_DIR, filePath);

    return {
        file: relativePath,
        name,
        email: extractField(content, 'Email'),
        aliases: extractList(content, 'Aliases'),
        organization: extractField(content, 'Organization'),
        role: extractField(content, 'Role'),
    };
}

/**
 * Parse an organization note and extract index data
 */
function parseOrganizationNote(filePath: string, content: string): OrganizationEntry {
    const name = extractTitle(content);
    const relativePath = path.relative(KNOWLEDGE_DIR, filePath);

    return {
        file: relativePath,
        name,
        domain: extractField(content, 'Domain'),
        aliases: extractList(content, 'Aliases'),
    };
}

/**
 * Parse a project note and extract index data
 */
function parseProjectNote(filePath: string, content: string): ProjectEntry {
    const name = extractTitle(content);
    const relativePath = path.relative(KNOWLEDGE_DIR, filePath);

    return {
        file: relativePath,
        name,
        status: extractField(content, 'Status'),
        aliases: extractList(content, 'Aliases'),
    };
}

/**
 * Parse a topic note and extract index data
 */
function parseTopicNote(filePath: string, content: string): TopicEntry {
    const name = extractTitle(content);
    const relativePath = path.relative(KNOWLEDGE_DIR, filePath);

    return {
        file: relativePath,
        name,
        keywords: extractList(content, 'Keywords'),
        aliases: extractList(content, 'Aliases'),
    };
}

/**
 * Parse a generic note (for non-standard folders)
 */
function parseOtherNote(filePath: string, content: string): OtherEntry {
    const name = extractTitle(content);
    const relativePath = path.relative(KNOWLEDGE_DIR, filePath);
    // Get the folder name (first part of relative path)
    const folder = relativePath.split(path.sep)[0] || 'root';

    return {
        file: relativePath,
        name,
        folder,
        aliases: extractList(content, 'Aliases'),
    };
}

/**
 * Recursively scan a directory for markdown files
 */
function scanDirectoryRecursive(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    const files: string[] = [];
    const entries = fs.readdirSync(dir);

    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            // Recursively scan subdirectories
            files.push(...scanDirectoryRecursive(fullPath));
        } else if (stat.isFile() && entry.endsWith('.md')) {
            files.push(fullPath);
        }
    }

    return files;
}

/**
 * Determine which folder a file belongs to based on its path
 */
function getFolderType(filePath: string): string {
    const relativePath = path.relative(KNOWLEDGE_DIR, filePath);
    const parts = relativePath.split(path.sep);

    // If file is directly in knowledge folder (no subfolder)
    if (parts.length === 1) {
        return 'root';
    }

    // Return the first folder name
    return parts[0];
}

/**
 * Build a complete index of the knowledge base
 * Scans all notes recursively and extracts searchable fields using folder-based parsing
 */
export function buildKnowledgeIndex(): KnowledgeIndex {
    const index: KnowledgeIndex = {
        people: [],
        organizations: [],
        projects: [],
        topics: [],
        other: [],
        buildTime: new Date().toISOString(),
    };

    // Scan entire knowledge directory recursively
    const allFiles = scanDirectoryRecursive(KNOWLEDGE_DIR);

    for (const filePath of allFiles) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const folderType = getFolderType(filePath);

            // Use folder-based parsing
            switch (folderType) {
                case 'People':
                    index.people.push(parsePersonNote(filePath, content));
                    break;
                case 'Organizations':
                    index.organizations.push(parseOrganizationNote(filePath, content));
                    break;
                case 'Projects':
                    index.projects.push(parseProjectNote(filePath, content));
                    break;
                case 'Topics':
                    index.topics.push(parseTopicNote(filePath, content));
                    break;
                default:
                    // Generic parsing for non-standard folders
                    index.other.push(parseOtherNote(filePath, content));
                    break;
            }
        } catch (error) {
            console.error(`Error parsing note ${filePath}:`, error);
        }
    }

    return index;
}

/**
 * Format the index as a string for inclusion in agent prompts
 */
export function formatIndexForPrompt(index: KnowledgeIndex): string {
    let output = '# Existing Knowledge Base Index\n\n';
    output += `Built at: ${index.buildTime}\n\n`;

    // People
    output += '## People\n\n';
    if (index.people.length === 0) {
        output += '_No people notes yet_\n\n';
    } else {
        output += '| File | Name | Email | Organization | Aliases |\n';
        output += '|------|------|-------|--------------|--------|\n';
        for (const person of index.people) {
            const aliases = person.aliases.length > 0 ? person.aliases.join(', ') : '-';
            output += `| ${person.file} | ${person.name} | ${person.email || '-'} | ${person.organization || '-'} | ${aliases} |\n`;
        }
        output += '\n';
    }

    // Organizations
    output += '## Organizations\n\n';
    if (index.organizations.length === 0) {
        output += '_No organization notes yet_\n\n';
    } else {
        output += '| File | Name | Domain | Aliases |\n';
        output += '|------|------|--------|--------|\n';
        for (const org of index.organizations) {
            const aliases = org.aliases.length > 0 ? org.aliases.join(', ') : '-';
            output += `| ${org.file} | ${org.name} | ${org.domain || '-'} | ${aliases} |\n`;
        }
        output += '\n';
    }

    // Projects
    output += '## Projects\n\n';
    if (index.projects.length === 0) {
        output += '_No project notes yet_\n\n';
    } else {
        output += '| File | Name | Status | Aliases |\n';
        output += '|------|------|--------|--------|\n';
        for (const project of index.projects) {
            const aliases = project.aliases.length > 0 ? project.aliases.join(', ') : '-';
            output += `| ${project.file} | ${project.name} | ${project.status || '-'} | ${aliases} |\n`;
        }
        output += '\n';
    }

    // Topics
    output += '## Topics\n\n';
    if (index.topics.length === 0) {
        output += '_No topic notes yet_\n\n';
    } else {
        output += '| File | Name | Keywords | Aliases |\n';
        output += '|------|------|----------|--------|\n';
        for (const topic of index.topics) {
            const keywords = topic.keywords.length > 0 ? topic.keywords.join(', ') : '-';
            const aliases = topic.aliases.length > 0 ? topic.aliases.join(', ') : '-';
            output += `| ${topic.file} | ${topic.name} | ${keywords} | ${aliases} |\n`;
        }
        output += '\n';
    }

    // Other (non-standard folders)
    if (index.other.length > 0) {
        output += '## Other Notes\n\n';
        output += '| File | Name | Folder | Aliases |\n';
        output += '|------|------|--------|--------|\n';
        for (const note of index.other) {
            const aliases = note.aliases.length > 0 ? note.aliases.join(', ') : '-';
            output += `| ${note.file} | ${note.name} | ${note.folder} | ${aliases} |\n`;
        }
        output += '\n';
    }

    return output;
}
