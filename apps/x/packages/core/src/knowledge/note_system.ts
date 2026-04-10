import path from "path";
import fs from "fs";
import { WorkDir } from "../config/config.js";

export interface NoteTypeDefinition {
  type: string;
  folder: string;
  template: string;
  extractionGuide: string;
}

// ── Default definitions (used to seed WorkDir/config/notes.json) ─────────────

const DEFAULT_NOTE_TYPE_DEFINITIONS: NoteTypeDefinition[] = [
  {
    type: "People",
    folder: "People",
    template: `# {Full Name}

## Info
**Role:** {role, or inferred role with qualifier, or leave blank if truly unknown}
**Organization:** [[Organizations/{organization}]] or leave blank
**Email:** {email or leave blank}
**Aliases:** {comma-separated: first name, nicknames, email}
**First met:** {YYYY-MM-DD}
**Last update:** {YYYY-MM-DD}

## Summary
{2-3 sentences: Who they are, why you know them, what you're working on together.}

## Connected to
- [[Organizations/{Organization}]] — works at
- [[People/{Person}]] — {colleague, introduced by, reports to}
- [[Projects/{Project}]] — {role}

## Activity
- **{YYYY-MM-DD}** ({meeting|email|voice memo}): {Summary with [[Folder/Name]] links}

## Key facts
{Substantive facts only. Leave empty if none.}

## Open items
{Commitments and next steps only. Leave empty if none.}`,
    extractionGuide:
      "Look for: name, role, organization, email, aliases, relationship context",
  },
  {
    type: "Organizations",
    folder: "Organizations",
    template: `# {Organization Name}

## Info
**Type:** {company|team|institution|other}
**Industry:** {industry or leave blank}
**Relationship:** {customer|prospect|partner|competitor|vendor|other}
**Domain:** {primary email domain}
**Aliases:** {comma-separated: short names, abbreviations}
**First met:** {YYYY-MM-DD}
**Last update:** {YYYY-MM-DD}

## Summary
{2-3 sentences: What this org is, what your relationship is.}

## People
- [[People/{Person}]] — {role}

## Contacts
{For transactional contacts who don't get their own notes}

## Projects
- [[Projects/{Project}]] — {relationship}

## Activity
- **{YYYY-MM-DD}** ({meeting|email|voice memo}): {Summary with [[Folder/Name]] links}

## Key facts
{Substantive facts only. Leave empty if none.}

## Open items
{Commitments and next steps only. Leave empty if none.}`,
    extractionGuide:
      "Look for: organization name, type, industry, relationship, domain, key people, projects",
  },
  {
    type: "Projects",
    folder: "Projects",
    template: `# {Project Name}

## Info
**Type:** {deal|product|initiative|hiring|other}
**Status:** {active|planning|on hold|completed|cancelled}
**Started:** {YYYY-MM-DD or leave blank}
**Last update:** {YYYY-MM-DD}

## Summary
{2-3 sentences: What this project is, goal, current state.}

## People
- [[People/{Person}]] — {role}

## Organizations
- [[Organizations/{Org}]] — {customer|partner|etc.}

## Related
- [[Topics/{Topic}]] — {relationship}
- [[Projects/{Project}]] — {relationship}

## Timeline
**{YYYY-MM-DD}** ({meeting|email})
{What happened.}

## Decisions
- **{YYYY-MM-DD}**: {Decision}. {Rationale}.

## Open items
{Commitments and next steps only. Leave empty if none.}

## Key facts
{Substantive facts only. Leave empty if none.}`,
    extractionGuide:
      "Look for: project name, type, status, people involved, organizations, timeline, decisions",
  },
  {
    type: "Topics",
    folder: "Topics",
    template: `# {Topic Name}

## About
{1-2 sentences: What this topic covers.}

**Keywords:** {comma-separated}
**Aliases:** {other ways this topic is referenced}
**First mentioned:** {YYYY-MM-DD}
**Last update:** {YYYY-MM-DD}

## Related
- [[People/{Person}]] — {relationship}
- [[Organizations/{Org}]] — {relationship}
- [[Projects/{Project}]] — {relationship}

## Log
**{YYYY-MM-DD}** ({meeting|email}: {title})
{Summary with [[Folder/Name]] links}

## Decisions
- **{YYYY-MM-DD}**: {Decision}

## Open items
{Commitments and next steps only. Leave empty if none.}

## Key facts
{Substantive facts only. Leave empty if none.}`,
    extractionGuide:
      "Look for: topic name, keywords, related people/orgs/projects, decisions, key facts",
  },
  {
    type: "Meetings",
    folder: "Meetings",
    template: "",
    extractionGuide:
      "Look for: meeting title, date, attendees, source (granola or fireflies), duration, topics discussed",
  },
];

// ── Disk-backed config with mtime caching ──────────────────────────────────

export const NOTES_CONFIG_PATH = path.join(WorkDir, "config", "notes.json");

let cachedNoteTypeDefinitions: NoteTypeDefinition[] | null = null;
let cachedMtimeMs: number | null = null;

function ensureNotesConfigSync(): void {
  if (!fs.existsSync(NOTES_CONFIG_PATH)) {
    fs.writeFileSync(
      NOTES_CONFIG_PATH,
      JSON.stringify(DEFAULT_NOTE_TYPE_DEFINITIONS, null, 2) + "\n",
      "utf8",
    );
  }
}

export function getNoteTypeDefinitions(): NoteTypeDefinition[] {
  ensureNotesConfigSync();
  try {
    const stats = fs.statSync(NOTES_CONFIG_PATH);
    if (cachedNoteTypeDefinitions && cachedMtimeMs === stats.mtimeMs) {
      return cachedNoteTypeDefinitions;
    }
    const content = fs.readFileSync(NOTES_CONFIG_PATH, "utf8");
    cachedNoteTypeDefinitions = JSON.parse(content);
    cachedMtimeMs = stats.mtimeMs;
    return cachedNoteTypeDefinitions!;
  } catch {
    cachedNoteTypeDefinitions = null;
    cachedMtimeMs = null;
    return DEFAULT_NOTE_TYPE_DEFINITIONS;
  }
}

// ── Render helper ────────────────────────────────────────────────────────

export function renderNoteTypesBlock(): string {
  const defs = getNoteTypeDefinitions();
  const sections = defs.map(
    (d) =>
      `## ${d.type}\n\`\`\`markdown\n${d.template}\n\`\`\``,
  );
  return `# Note Templates\n\n${sections.join("\n\n")}`;
}
