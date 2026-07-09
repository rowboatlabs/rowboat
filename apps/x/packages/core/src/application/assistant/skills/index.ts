import path from "node:path";
import { fileURLToPath } from "node:url";
import { isModelActivated, type CapabilityDefinition } from "../capabilities/types.js";
import { loadDiskSkills } from "./disk-loader.js";
import builtinToolsSkill from "./builtin-tools/skill.js";
import deletionGuardrailsSkill from "./deletion-guardrails/skill.js";
import docCollabSkill from "./doc-collab/skill.js";
import draftEmailsSkill from "./draft-emails/skill.js";
import mcpIntegrationSkill from "./mcp-integration/skill.js";
import meetingPrepSkill from "./meeting-prep/skill.js";
import organizeFilesSkill from "./organize-files/skill.js";
import createPresentationsSkill from "./create-presentations/skill.js";

import appNavigationSkill from "./app-navigation/skill.js";
import browserControlSkill from "./browser-control/skill.js";
import codeWithAgentsSkill from "./code-with-agents/skill.js";
import composioIntegrationSkill from "./composio-integration/skill.js";
import liveNoteSkill from "./live-note/skill.js";
import backgroundTaskSkill from "./background-task/skill.js";
import notifyUserSkill from "./notify-user/skill.js";
import appsSkill from "./apps/skill.js";
import slackSkill from "./slack/skill.js";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PREFIX = "src/application/assistant/skills";

// console.log(liveNoteSkill);

// A skill is the model-activated subset of the capability record
// (capabilities/types.ts): lazy guidance the model pulls in via loadSkill,
// plus the BuiltinTools it owns. `id` doubles as the folder name. Tool names
// are validated against the live catalog where descriptors are built
// (loadSkill / the agent resolver); unknown names are dropped there.
type SkillDefinition = CapabilityDefinition & { content: string };

type ResolvedSkill = {
  id: string;
  catalogPath: string;
  content: string;
};

const definitions: SkillDefinition[] = [
  {
    id: "create-presentations",
    title: "Create Presentations",
    summary: "Create PDF presentations and slide decks from natural language requests using knowledge base context.",
    content: createPresentationsSkill,
    tools: ["file-writeText", "file-mkdir"],
  },
  {
    id: "doc-collab",
    title: "Document Collaboration",
    summary: "Collaborate on documents - create, edit, and refine notes and documents in the knowledge base.",
    content: docCollabSkill,
    tools: ["file-writeText", "file-editText", "file-mkdir"],
  },
  {
    id: "draft-emails",
    title: "Draft Emails",
    summary: "Process incoming emails and create draft responses using calendar and knowledge base for context.",
    content: draftEmailsSkill,
    tools: ["composio-search-tools", "composio-execute-tool"],
  },
  {
    id: "meeting-prep",
    title: "Meeting Prep",
    summary: "Prepare for meetings by gathering context about attendees from the knowledge base.",
    content: meetingPrepSkill,
  },
  {
    id: "organize-files",
    title: "Organize Files",
    summary: "Find, organize, and tidy up files on the user's machine. Move files to folders, clean up Desktop/Downloads, locate specific files.",
    content: organizeFilesSkill,
    tools: [
      "file-stat",
      "file-writeText",
      "file-editText",
      "file-mkdir",
      "file-rename",
      "file-copy",
      "file-remove",
    ],
  },
  {
    id: "builtin-tools",
    title: "Builtin Tools Reference",
    summary: "Understanding and using builtin tools (especially executeCommand for bash/shell) in agent definitions. Loading this attaches the FULL builtin toolset — the escape hatch when no specialized skill covers a tool you need.",
    content: builtinToolsSkill,
    // Every non-base builtin: kept in sync by a startup assertion in
    // builtin-tools.ts rather than by hand.
    tools: [],
  },
  {
    id: "mcp-integration",
    title: "MCP Integration Guidance",
    summary: "Discovering, executing, and integrating MCP tools. Use this to check what external capabilities are available and execute MCP tools on behalf of users.",
    content: mcpIntegrationSkill,
    tools: ["addMcpServer", "listMcpServers", "listMcpTools", "executeMcpTool"],
  },
  {
    id: "composio-integration",
    title: "Composio Integration",
    summary: "Interact with third-party services (Gmail, GitHub, Slack, LinkedIn, Notion, Jira, Google Sheets, etc.) via Composio. Search, connect, and execute tools.",
    content: composioIntegrationSkill,
    tools: [
      "composio-list-toolkits",
      "composio-search-tools",
      "composio-execute-tool",
      "composio-connect-toolkit",
      "app-navigation",
    ],
  },
  {
    id: "deletion-guardrails",
    title: "Deletion Guardrails",
    summary: "Following the confirmation process before removing workflows or agents and their dependencies.",
    content: deletionGuardrailsSkill,
    tools: ["file-remove"],
  },
  {
    id: "app-navigation",
    title: "App Navigation",
    summary: "Navigate the app UI - open notes, switch views, filter/search the knowledge base, and manage saved views.",
    content: appNavigationSkill,
    tools: ["app-navigation", "app-set-data"],
  },
  {
    id: "code-with-agents",
    title: "Code with Agents",
    summary: "Write code, build projects, create scripts, or fix bugs by delegating to Claude Code or Codex.",
    content: codeWithAgentsSkill,
  },
  {
    id: "apps",
    title: "Rowboat Apps",
    summary: "Build a Rowboat App the user opens inside Rowboat — a static web app on its own origin, powered by their integrations and an optional background agent. Use when the user asks to make/build/create an app or dashboard; for ambiguous 'show me X' requests, confirm whether they want an app first.",
    content: appsSkill,
    tools: [
      "app-navigation",
      "app-set-data",
      "list-models",
      "composio-search-tools",
      "composio-execute-tool",
      "create-background-task",
      "run-background-task-agent",
    ],
  },
  {
    id: "background-task",
    title: "Background Tasks",
    summary: "Set up a recurring background task — persistent instructions the agent fires on a schedule and/or on matching events (Gmail, Calendar). Either maintains an `index.md` digest (OUTPUT mode) or performs a recurring side-effect like drafting a reply / posting to Slack / calling an API (ACTION mode). Flagship surface for anything recurring.",
    content: backgroundTaskSkill,
    tools: [
      "create-background-task",
      "patch-background-task",
      "run-background-task-agent",
      "file-writeText",
      "file-editText",
    ],
  },
  {
    id: "live-note",
    title: "Live Notes",
    summary: "Make a specific markdown note self-updating — a single `live:` objective in the frontmatter that the live-note agent maintains on a schedule or on incoming events. Load only when the user explicitly says 'live note' / 'live-note'; for anything else recurring, prefer the background-task skill.",
    content: liveNoteSkill,
    tools: ["run-live-note-agent", "file-writeText", "file-editText"],
  },
  {
    id: "browser-control",
    title: "Browser Control",
    summary: "Control the embedded browser pane - open sites, inspect page state, and interact with indexed page elements.",
    content: browserControlSkill,
    tools: ["browser-control", "load-browser-skill"],
  },
  {
    // Excluded from the catalog when Slack isn't connected (see
    // buildCopilotInstructions excludeIds), mirroring composio-integration.
    id: "slack",
    title: "Slack",
    summary: "Read, search, and send Slack messages via the agent-slack CLI — catch up on channels, summarize threads, list users. Load FIRST for ANY Slack request; Slack is connected natively, never through Composio.",
    content: slackSkill,
  },
  {
    id: "notify-user",
    title: "Notify User",
    summary: "Send native desktop notifications with optional clickable links — including rowboat:// deep links that open a specific note, chat, or view inside the app.",
    content: notifyUserSkill,
    tools: ["notify-user"],
  },
];

type SkillEntry = SkillDefinition & { catalogPath: string; skillFile?: string };

const bundledEntries: SkillEntry[] = definitions.map((definition) => ({
  ...definition,
  catalogPath: `${CATALOG_PREFIX}/${definition.id}/skill.ts`,
}));

// A disk skill may not shadow a bundled skill: on id collision, bundled wins.
const bundledIds = new Set(definitions.map((d) => d.id));

// ---- Disk skill layer (refreshable at runtime) ----
// Bundled skills are static. Disk skills (~/.rowboat/skills, ~/.agents/skills)
// can be added/edited/removed while the app runs, so they live in a mutable
// list rebuilt by refreshDiskSkills() and resolved via a separate alias map.
let diskEntries: SkillEntry[] = [];
const diskAliasMap = new Map<string, ResolvedSkill>();

function loadDiskEntries(): SkillEntry[] {
  return loadDiskSkills()
    .filter((skill) => {
      if (bundledIds.has(skill.id)) {
        console.warn(`[disk-skills] Disk skill '${skill.id}' (${skill.dir}) shadows a built-in skill; keeping the built-in.`);
        return false;
      }
      return true;
    })
    .map((skill) => ({
      id: skill.id,
      title: skill.title,
      summary: skill.summary,
      content: skill.content,
      ...(skill.tools ? { tools: skill.tools } : {}),
      // For disk skills the catalog/loadSkill reference is the absolute SKILL.md path.
      catalogPath: skill.skillFile,
      skillFile: skill.skillFile,
    }));
}

// The full, current skill set (bundled first so it wins on any collision).
function getSkillEntries(): SkillEntry[] {
  return [...bundledEntries, ...diskEntries];
}

/**
 * Build a skill catalog string, optionally excluding specific skills by ID.
 * Reads the live skill set, so it reflects disk skills added/removed at runtime.
 */
export function buildSkillCatalog(options?: { excludeIds?: string[] }): string {
  // The catalog advertises the model-activated subset only: app/always
  // capabilities are composed into the system prompt by the assembly layer,
  // not offered for loadSkill.
  const modelEntries = getSkillEntries().filter(isModelActivated);
  const entries = options?.excludeIds
    ? modelEntries.filter(e => !options.excludeIds!.includes(e.id))
    : modelEntries;
  const sections = entries.map((entry) => [
    `## ${entry.title}`,
    `- **Skill file:** \`${entry.catalogPath}\``,
    `- **Use it for:** ${entry.summary}`,
    ...(entry.tools && entry.tools.length > 0
      ? [`- **Tools it attaches:** ${entry.tools.join(", ")}`]
      : []),
  ].join("\n"));
  return [
    "# Rowboat Skill Catalog",
    "",
    "Use this catalog to see which specialized skills you can load. Each entry lists the exact skill file plus a short description of when it helps.",
    "",
    sections.join("\n\n"),
  ].join("\n");
}

const normalizeIdentifier = (value: string) =>
  value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");

// Bundled aliases are static; disk aliases live in diskAliasMap so they can be
// rebuilt wholesale on refresh without disturbing the bundled entries.
const aliasMap = new Map<string, ResolvedSkill>();

const registerAlias = (alias: string, entry: ResolvedSkill, target: Map<string, ResolvedSkill> = aliasMap) => {
  const normalized = normalizeIdentifier(alias);
  if (!normalized) return;
  target.set(normalized, entry);
};

const registerAliasVariants = (alias: string, entry: ResolvedSkill, target: Map<string, ResolvedSkill> = aliasMap) => {
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
    registerAlias(variant, entry, target);
  }
};

for (const entry of bundledEntries) {
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

// Disk skills resolve by their id and by their absolute on-disk SKILL.md path,
// so the existing loadSkill tool can load them unchanged. Rebuilt on refresh.
function rebuildDiskAliases(): void {
  diskAliasMap.clear();
  for (const entry of diskEntries) {
    const resolvedEntry: ResolvedSkill = {
      id: entry.id,
      catalogPath: entry.catalogPath,
      content: entry.content,
    };
    registerAlias(entry.id, resolvedEntry, diskAliasMap);
    if (entry.skillFile) {
      registerAlias(entry.skillFile, resolvedEntry, diskAliasMap);
    }
  }
}

// Live-updated in place (same array binding) so importers see current ids.
export const availableSkills: string[] = [];

/**
 * Re-scan disk skills and rebuild the disk catalog/alias entries. Bundled
 * skills are untouched. Callers (the disk-skills watcher) should follow this
 * with invalidateCopilotInstructionsCache() so the next agent run picks it up.
 * Returns the number of disk skills currently loaded.
 */
export function refreshDiskSkills(): number {
  diskEntries = loadDiskEntries();
  rebuildDiskAliases();
  availableSkills.length = 0;
  for (const entry of getSkillEntries()) availableSkills.push(entry.id);
  return diskEntries.length;
}

// Initial disk load at module init.
refreshDiskSkills();

// Snapshot of the catalog at module load, kept for backward-compatible
// consumers (e.g. the legacy CopilotInstructions export). Runtime consumers
// should call buildSkillCatalog() to get the live set.
export const skillCatalog = buildSkillCatalog();

export function resolveSkill(identifier: string): ResolvedSkill | null {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) return null;

  // Bundled wins over disk on any alias collision.
  return aliasMap.get(normalized) ?? diskAliasMap.get(normalized) ?? null;
}

/**
 * The BuiltinTools names a skill declares (empty for guidance-only skills).
 * Read live so it reflects disk-skill refreshes and the derived
 * builtin-tools escape-hatch list.
 */
export function skillToolNames(skillId: string): string[] {
  const entry = getSkillEntries().find((e) => e.id === skillId);
  return entry?.tools ? [...entry.tools] : [];
}

/**
 * The builtin-tools skill attaches the full non-base toolset. Its list is
 * derived from the live BuiltinTools catalog by builtin-tools.ts at module
 * init — a hand-written list here would drift, and importing the catalog
 * from this module would be an import cycle (builtin-tools.ts imports
 * resolveSkill).
 */
export function setBuiltinToolsSkillTools(names: string[]): void {
  const entry = bundledEntries.find((e) => e.id === "builtin-tools");
  if (entry) {
    entry.tools = [...names];
  }
}
