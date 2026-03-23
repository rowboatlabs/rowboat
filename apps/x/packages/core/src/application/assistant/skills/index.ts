import path from "node:path";
import { fileURLToPath } from "node:url";
import builtinToolsSkill from "./builtin-tools/skill.js";
import deletionGuardrailsSkill from "./deletion-guardrails/skill.js";
import docCollabSkill from "./doc-collab/skill.js";
import draftEmailsSkill from "./draft-emails/skill.js";
import mcpIntegrationSkill from "./mcp-integration/skill.js";
import meetingPrepSkill from "./meeting-prep/skill.js";
import organizeFilesSkill from "./organize-files/skill.js";
import slackSkill from "./slack/skill.js";
import backgroundAgentsSkill from "./background-agents/skill.js";
import createPresentationsSkill from "./create-presentations/skill.js";
import webSearchSkill from "./web-search/skill.js";
import appNavigationSkill from "./app-navigation/skill.js";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PREFIX = "src/application/assistant/skills";

export type SkillDefinition = {
  id: string;  // Also used as folder name
  title: string;
  summary: string;
  version: string;  // semver
  content: string;
};

type ResolvedSkill = {
  id: string;
  catalogPath: string;
  content: string;
};

export const officialDefinitions: SkillDefinition[] = [
  {
    id: "create-presentations",
    title: "Create Presentations",
    summary: "Create PDF presentations and slide decks from natural language requests using knowledge base context.",
    version: "1.0.0",
    content: createPresentationsSkill,
  },
  {
    id: "doc-collab",
    title: "Document Collaboration",
    summary: "Collaborate on documents - create, edit, and refine notes and documents in the knowledge base.",
    version: "1.0.0",
    content: docCollabSkill,
  },
  {
    id: "draft-emails",
    title: "Draft Emails",
    summary: "Process incoming emails and create draft responses using calendar and knowledge base for context.",
    version: "1.1.0",
    content: draftEmailsSkill,
  },
  {
    id: "meeting-prep",
    title: "Meeting Prep",
    summary: "Prepare for meetings by gathering context about attendees from the knowledge base.",
    version: "1.0.0",
    content: meetingPrepSkill,
  },
  {
    id: "organize-files",
    title: "Organize Files",
    summary: "Find, organize, and tidy up files on the user's machine. Move files to folders, clean up Desktop/Downloads, locate specific files.",
    version: "1.0.0",
    content: organizeFilesSkill,
  },
  {
    id: "slack",
    title: "Slack Integration",
    summary: "Send Slack messages, view channel history, search conversations, find users, and manage team communication.",
    version: "1.0.0",
    content: slackSkill,
  },
  {
    id: "background-agents",
    title: "Background Agents",
    summary: "Creating, editing, and scheduling background agents. Configure schedules in agent-schedule.json and build multi-agent workflows.",
    version: "1.0.0",
    content: backgroundAgentsSkill,
  },
  {
    id: "builtin-tools",
    title: "Builtin Tools Reference",
    summary: "Understanding and using builtin tools (especially executeCommand for bash/shell) in agent definitions.",
    version: "1.0.0",
    content: builtinToolsSkill,
  },
  {
    id: "mcp-integration",
    title: "MCP Integration Guidance",
    summary: "Discovering, executing, and integrating MCP tools. Use this to check what external capabilities are available and execute MCP tools on behalf of users.",
    version: "1.0.0",
    content: mcpIntegrationSkill,
  },
  {
    id: "web-search",
    title: "Web Search",
    summary: "Searching the web or researching a topic. Guidance on when to use web-search vs research-search, and how many searches to do.",
    version: "1.0.0",
    content: webSearchSkill,
  },
  {
    id: "deletion-guardrails",
    title: "Deletion Guardrails",
    summary: "Following the confirmation process before removing workflows or agents and their dependencies.",
    version: "1.0.0",
    content: deletionGuardrailsSkill,
  },
  {
    id: "app-navigation",
    title: "App Navigation",
    summary: "Navigate the app UI - open notes, switch views, filter/search the knowledge base, and manage saved views.",
    version: "1.0.0",
    content: appNavigationSkill,
  },
];

const skillEntries = officialDefinitions.map((definition) => ({
  ...definition,
  catalogPath: `${CATALOG_PREFIX}/${definition.id}/skill.ts`,
}));

const catalogSections = skillEntries.map((entry) => [
  `## ${entry.title}`,
  `- **Skill file:** \`${entry.catalogPath}\``,
  `- **Use it for:** ${entry.summary}`,
].join("\n"));

export const skillCatalog = [
  "# Rowboat Skill Catalog",
  "",
  "Use this catalog to see which specialized skills you can load. Each entry lists the exact skill file plus a short description of when it helps.",
  "",
  catalogSections.join("\n\n"),
].join("\n");

const normalizeIdentifier = (value: string) =>
  value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");

const aliasMap = new Map<string, ResolvedSkill>();

const registerAlias = (alias: string, entry: ResolvedSkill) => {
  const normalized = normalizeIdentifier(alias);
  if (!normalized) return;
  aliasMap.set(normalized, entry);
};

const registerAliasVariants = (alias: string, entry: ResolvedSkill) => {
  const normalized = normalizeIdentifier(alias);
  if (!normalized) return;

  const variants = new Set<string>([normalized]);

  if (/\.(ts|js)$/i.test(normalized)) {
    variants.add(normalized.replace(/\.(ts|js)$/i, ""));
    variants.add(
      normalized.endsWith(".ts") ? normalized.replace(/\.ts$/i, ".js") : normalized.replace(/\.js$/i, ".ts"),
    );
  } else {
    variants.add(`${normalized}.ts`);
    variants.add(`${normalized}.js`);
  }

  for (const variant of variants) {
    registerAlias(variant, entry);
  }
};

for (const entry of skillEntries) {
  const absoluteTs = path.join(CURRENT_DIR, entry.id, "skill.ts");
  const absoluteJs = path.join(CURRENT_DIR, entry.id, "skill.js");
  const resolvedEntry: ResolvedSkill = {
    id: entry.id,
    catalogPath: entry.catalogPath,
    content: entry.content,
  };

  const baseAliases = [
    entry.id,
    `${entry.id}/skill`,
    `${entry.id}/skill.ts`,
    `${entry.id}/skill.js`,
    `skills/${entry.id}/skill.ts`,
    `skills/${entry.id}/skill.js`,
    `${CATALOG_PREFIX}/${entry.id}/skill.ts`,
    `${CATALOG_PREFIX}/${entry.id}/skill.js`,
    absoluteTs,
    absoluteJs,
  ];

  for (const alias of baseAliases) {
    registerAliasVariants(alias, resolvedEntry);
  }
}

export const availableSkills = skillEntries.map((entry) => entry.id);

export function resolveSkill(identifier: string): ResolvedSkill | null {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) return null;

  return aliasMap.get(normalized) ?? null;
}
