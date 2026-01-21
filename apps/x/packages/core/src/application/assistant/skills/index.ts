import path from "node:path";
import { fileURLToPath } from "node:url";
import builtinToolsSkill from "./builtin-tools/skill.js";
import deletionGuardrailsSkill from "./deletion-guardrails/skill.js";
import docCollabSkill from "./doc-collab/skill.js";
import draftEmailsSkill from "./draft-emails/skill.js";
import mcpIntegrationSkill from "./mcp-integration/skill.js";
import meetingPrepSkill from "./meeting-prep/skill.js";
import organizeFilesSkill from "./organize-files/skill.js";
import workflowAuthoringSkill from "./workflow-authoring/skill.js";
import workflowRunOpsSkill from "./workflow-run-ops/skill.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const CURRENT_DIR = path.dirname(CURRENT_FILE);
const CATALOG_PREFIX = "src/application/assistant/skills";

type SkillDefinition = {
  id: string;
  title: string;
  folder: string;
  summary: string;
  content: string;
};

type ResolvedSkill = {
  id: string;
  catalogPath: string;
  content: string;
};

const definitions: SkillDefinition[] = [
  {
    id: "doc-collab",
    title: "Document Collaboration",
    folder: "doc-collab",
    summary: "Collaborate on documents - create, edit, and refine notes and documents in the knowledge base.",
    content: docCollabSkill,
  },
  {
    id: "draft-emails",
    title: "Draft Emails",
    folder: "draft-emails",
    summary: "Process incoming emails and create draft responses using calendar and knowledge base for context.",
    content: draftEmailsSkill,
  },
  {
    id: "meeting-prep",
    title: "Meeting Prep",
    folder: "meeting-prep",
    summary: "Prepare for meetings by gathering context about attendees from the knowledge base.",
    content: meetingPrepSkill,
  },
  {
    id: "organize-files",
    title: "Organize Files",
    folder: "organize-files",
    summary: "Find, organize, and tidy up files on the user's machine. Move files to folders, clean up Desktop/Downloads, locate specific files.",
    content: organizeFilesSkill,
  },
  {
    id: "workflow-authoring",
    title: "Workflow Authoring",
    folder: "workflow-authoring",
    summary: "Creating or editing workflows/agents, validating schema rules, and keeping filenames aligned with JSON ids.",
    content: workflowAuthoringSkill,
  },
  {
    id: "builtin-tools",
    title: "Builtin Tools Reference",
    folder: "builtin-tools",
    summary: "Understanding and using builtin tools (especially executeCommand for bash/shell) in agent definitions.",
    content: builtinToolsSkill,
  },
  {
    id: "mcp-integration",
    title: "MCP Integration Guidance",
    folder: "mcp-integration",
    summary: "Discovering, executing, and integrating MCP tools. Use this to check what external capabilities are available and execute MCP tools on behalf of users.",
    content: mcpIntegrationSkill,
  },
  {
    id: "deletion-guardrails",
    title: "Deletion Guardrails",
    folder: "deletion-guardrails",
    summary: "Following the confirmation process before removing workflows or agents and their dependencies.",
    content: deletionGuardrailsSkill,
  },
  {
    id: "workflow-run-ops",
    title: "Workflow Run Operations",
    folder: "workflow-run-ops",
    summary: "Commands that list workflow runs, inspect paused executions, or manage cron schedules for workflows.",
    content: workflowRunOpsSkill,
  },
];

const skillEntries = definitions.map((definition) => ({
  ...definition,
  catalogPath: `${CATALOG_PREFIX}/${definition.folder}/skill.ts`,
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
  const absoluteTs = path.join(CURRENT_DIR, entry.folder, "skill.ts");
  const absoluteJs = path.join(CURRENT_DIR, entry.folder, "skill.js");
  const resolvedEntry: ResolvedSkill = {
    id: entry.id,
    catalogPath: entry.catalogPath,
    content: entry.content,
  };

  const baseAliases = [
    entry.id,
    entry.folder,
    `${entry.folder}/skill`,
    `${entry.folder}/skill.ts`,
    `${entry.folder}/skill.js`,
    `skills/${entry.folder}/skill.ts`,
    `skills/${entry.folder}/skill.js`,
    `${CATALOG_PREFIX}/${entry.folder}/skill.ts`,
    `${CATALOG_PREFIX}/${entry.folder}/skill.js`,
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
