import { z, ZodType } from "zod";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { executeCommand, executeCommandAbortable } from "./command-executor.js";
import { agentSlackShimEnv } from "../../slack/agent-slack-exec.js";
import { resolveSkill, availableSkills } from "../assistant/skills/index.js";
import { executeTool, listServers, listTools } from "../../mcp/mcp.js";
import container from "../../di/container.js";
import { IMcpConfigRepo } from "../..//mcp/repo.js";
import { McpServerDefinition } from "@x/shared/dist/mcp.js";
import * as files from "../../filesystem/files.js";
import { IAgentsRepo } from "../../agents/repo.js";
import { WorkDir } from "../../config/config.js";
import { composioAccountsRepo } from "../../composio/repo.js";
import { executeAction as executeComposioAction, isConfigured as isComposioConfigured, searchTools as searchComposioTools } from "../../composio/client.js";
import { CURATED_TOOLKITS, CURATED_TOOLKIT_SLUGS } from "@x/shared/dist/composio.js";
import { MiniAppManifest } from "@x/shared/dist/mini-app.js";
import { BrowserControlInputSchema, type BrowserControlInput } from "@x/shared/dist/browser-control.js";
import { BackgroundTaskSchema, TriggersSchema } from "@x/shared/dist/background-task.js";
import type { CodeModeManager } from "../../code-mode/acp/manager.js";
import type { CodePermissionRegistry } from "../../code-mode/acp/permission-registry.js";
import { ICodeModeConfigRepo } from "../../code-mode/repo.js";
import type { ApprovalPolicy } from "@x/shared/dist/code-mode.js";
import type { ICodeProjectsRepo } from "../../code-mode/projects/repo.js";
import * as gitService from "../../code-mode/git/service.js";

// Inputs for the bg-task builtin tools. Reuse the canonical schema field
// descriptions; only `triggers` gets a tighter contextual override (the
// shared TriggersSchema description is written from the live-note perspective).
const CreateBackgroundTaskInput = BackgroundTaskSchema.pick({
    name: true,
    instructions: true,
    triggers: true,
    model: true,
    provider: true,
}).extend({
    triggers: TriggersSchema.optional().describe('All three sub-fields (cronExpr, windows, eventMatchCriteria) are independently optional — mix freely. No triggers at all = manual-only (user clicks Run).'),
    projectDir: z.string().optional().describe(
        "Set this ONLY when the user wants the task to WRITE CODE. An absolute path (or ~/…) to a LOCAL GIT REPOSITORY with at least one commit. It turns this into a *coding task*: each run scans the trigger source for actionable items and implements them autonomously in isolated git worktrees off this repo — never touching the user's checkout. Extract the directory from the user's request (e.g. 'use ~/Work/space/test as the work directory'). Omit for ordinary output/action tasks.",
    ),
});

const PatchBackgroundTaskInput = BackgroundTaskSchema.pick({
    name: true,
    instructions: true,
    active: true,
    triggers: true,
    model: true,
    provider: true,
}).partial().extend({
    slug: z.string().describe('The slug of the task to update (the folder name under bg-tasks/).'),
    triggers: TriggersSchema.optional().describe('Replace the triggers object. To remove all triggers (make manual-only) pass an empty object.'),
    projectDir: z.string().optional().describe("Point an existing task at a code repo (or change which one) to make it a coding task. Absolute path or ~/… to a local git repository with at least one commit. Same rules as on create."),
});

// Turn a user-supplied directory into a registered code project id. Reuses the
// same idempotent registry the Code-section picker writes to (add() validates the
// dir exists & is a directory, and dedupes by resolved path). Returns a soft
// `warning` — not an error — when the repo isn't yet worktree-ready, so the task
// still gets created and the copilot can tell the user what to fix.
function expandHome(p: string): string {
    const t = p.trim();
    if (t === '~') return os.homedir();
    if (t.startsWith('~/') || t.startsWith(`~${path.sep}`)) return path.join(os.homedir(), t.slice(2));
    return t;
}

async function resolveCodeProject(dirPath: string): Promise<
    { ok: true; projectId: string; path: string; warning?: string } | { ok: false; error: string }
> {
    const abs = path.resolve(expandHome(dirPath));
    const projectsRepo = container.resolve<ICodeProjectsRepo>('codeProjectsRepo');
    let project: Awaited<ReturnType<ICodeProjectsRepo['add']>>;
    try {
        project = await projectsRepo.add(abs);
    } catch (err) {
        return { ok: false, error: `Could not use '${dirPath}' as a code directory: ${err instanceof Error ? err.message : String(err)}` };
    }
    // Worktree isolation needs a real git repo with at least one commit
    // (codeSessionService.create throws otherwise). Surface it now as a soft
    // warning rather than letting the next run fail silently.
    let warning: string | undefined;
    try {
        const info = await gitService.repoInfo(project.path);
        if (!info.isGitRepo) warning = `${project.path} is not a git repository yet — run \`git init\` and make a commit, or the coding sessions will fail.`;
        else if (!info.hasCommits) warning = `${project.path} has no commits yet — make an initial commit, or the coding sessions will fail.`;
    } catch { /* best effort — worktree creation will surface it later */ }
    return { ok: true, projectId: project.id, path: project.path, ...(warning ? { warning } : {}) };
}
import { ensureLoaded as ensureBrowserSkillsLoaded, readSkillContent as readBrowserSkillContent, refreshFromRemote as refreshBrowserSkills } from "../browser-skills/index.js";
import type { ToolContext } from "./exec-tool.js";
import { generateText } from "ai";
import { createProvider } from "../../models/models.js";
import { getDefaultModelAndProvider, resolveProviderConfig } from "../../models/defaults.js";
import { captureLlmUsage } from "../../analytics/usage.js";
import { getCurrentUseCase, withUseCase } from "../../analytics/use_case.js";
import { isSignedIn } from "../../account/account.js";
import { getAccessToken } from "../../auth/tokens.js";
import { API_URL } from "../../config/env.js";
import type { IBrowserControlService } from "../browser-control/service.js";
import type { INotificationService } from "../notification/service.js";
import { notifyIfEnabled } from "../notification/notifier.js";
// Parser libraries are loaded dynamically inside parseFile.execute()
// to avoid pulling pdfjs-dist's DOM polyfills into the main bundle.
// Import paths are computed so esbuild cannot statically resolve them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _importDynamic = new Function('mod', 'return import(mod)') as (mod: string) => Promise<any>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BuiltinToolsSchema = z.record(z.string(), z.object({
    description: z.string(),
	inputSchema: z.custom<ZodType>(),
    execute: z.function({
        input: z.any(), // (input, ctx?) => Promise<any>
        output: z.promise(z.any()),
    }),
    isAvailable: z.custom<() => Promise<boolean>>().optional(),
}));

const LLMPARSE_MIME_TYPES: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
};


export const BuiltinTools: z.infer<typeof BuiltinToolsSchema> = {
    loadSkill: {
        description: "Load a Rowboat skill definition into context by fetching its guidance string",
        inputSchema: z.object({
            skillName: z.string().describe("Skill identifier or path (e.g., 'workflow-run-ops' or 'src/application/assistant/skills/workflow-run-ops/skill.ts')"),
        }),
        execute: async ({ skillName }: { skillName: string }) => {
            const resolved = resolveSkill(skillName);

            if (!resolved) {
                return {
                    success: false,
                    message: `Skill '${skillName}' not found. Available skills: ${availableSkills.join(", ")}`,
                };
            }

            return {
                success: true,
                skillName: resolved.id,
                path: resolved.catalogPath,
                content: resolved.content,
            };
        },
    },

    'file-getRoot': {
        description: 'Get the default root directory for relative file paths. Relative paths passed to file tools resolve against this directory.',
        inputSchema: z.object({}),
        execute: async () => {
            try {
                return { root: WorkDir };
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'file-exists': {
        description: 'Check if a file or directory exists. Accepts absolute paths, ~/ paths, or paths relative to the default root.',
        inputSchema: z.object({
            path: z.string().min(1).describe('File or directory path to check'),
        }),
        execute: async ({ path: filePath }: { path: string }) => {
            try {
                return await files.exists(filePath);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'file-stat': {
        description: 'Get file or directory statistics (size, modification time, etc.)',
        inputSchema: z.object({
            path: z.string().min(1).describe('File or directory path to stat'),
        }),
        execute: async ({ path: filePath }: { path: string }) => {
            try {
                return await files.stat(filePath);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'file-list': {
        description: 'List directory contents. Can recursively explore directory structure with options.',
        inputSchema: z.object({
            path: z.string().describe('Directory path to list. Use "." for the default root.'),
            recursive: z.boolean().optional().describe('Recursively list all subdirectories (default: false)'),
            includeStats: z.boolean().optional().describe('Include file stats like size and modification time (default: false)'),
            includeHidden: z.boolean().optional().describe('Include hidden files starting with . (default: false)'),
            allowedExtensions: z.array(z.string()).optional().describe('Filter by file extensions (e.g., [".json", ".ts"])'),
        }),
        execute: async ({
            path: filePath,
            recursive,
            includeStats,
            includeHidden,
            allowedExtensions
        }: {
            path: string;
            recursive?: boolean;
            includeStats?: boolean;
            includeHidden?: boolean;
            allowedExtensions?: string[];
        }) => {
            try {
                return await files.list(filePath || '.', {
                    recursive,
                    includeStats,
                    includeHidden,
                    allowedExtensions,
                });
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'file-readText': {
        description: 'Read a UTF-8 text file. Returns content with each line prefixed by its 1-indexed line number (e.g. `12: some text`). Use `offset` and `limit` to page through large files; defaults read up to 2000 lines starting at line 1. Output is wrapped in `<path>`, `<resolvedPath>`, `<type>`, `<content>` tags and ends with a footer indicating whether the read reached end-of-file or was truncated. Line numbers are display-only — do NOT include them when later writing or editing the file. Refuses binary files; use parseFile or LLMParse for documents, PDFs, images, and other non-text formats.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Text file path to read'),
            offset: z.coerce.number().int().min(1).optional().describe('1-indexed line to start reading from (default: 1).'),
            limit: z.coerce.number().int().min(1).optional().describe('Maximum number of lines to read (default: 2000).'),
        }),
        execute: async ({
            path: filePath,
            offset,
            limit,
        }: {
            path: string;
            offset?: number;
            limit?: number;
        }) => {
            try {
                return await files.readText(filePath, offset, limit);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'file-writeText': {
        description: 'Write or update UTF-8 text file contents. Automatically creates parent directories and supports atomic writes.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Text file path to write'),
            data: z.string().describe('UTF-8 text content to write'),
            atomic: z.boolean().optional().describe('Use atomic write (default: true)'),
            mkdirp: z.boolean().optional().describe('Create parent directories if needed (default: true)'),
            expectedEtag: z.string().optional().describe('ETag to check for concurrent modifications (conflict detection)'),
        }),
        execute: async ({
            path: filePath,
            data,
            atomic,
            mkdirp,
            expectedEtag
        }: {
            path: string;
            data: string;
            atomic?: boolean;
            mkdirp?: boolean;
            expectedEtag?: string;
        }) => {
            try {
                return await files.writeText(filePath, data, {
                    atomic,
                    mkdirp,
                    expectedEtag,
                });
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'file-editText': {
        description: 'Make precise edits to a UTF-8 text file by replacing specific text. Safer than rewriting entire files - produces smaller diffs and reduces risk of data loss. Refuses binary files.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Text file path to edit'),
            oldString: z.string().describe('Exact text to find and replace'),
            newString: z.string().describe('Replacement text'),
            replaceAll: z.boolean().optional().describe('Replace all occurrences (default: false, fails if not unique)'),
        }),
        execute: async ({
            path: filePath,
            oldString,
            newString,
            replaceAll = false
        }: {
            path: string;
            oldString: string;
            newString: string;
            replaceAll?: boolean;
        }) => {
            try {
                return await files.editText(filePath, oldString, newString, replaceAll);
            } catch (error) {
                return { error: error instanceof Error ? error.message : 'Unknown error' };
            }
        },
    },

    'file-mkdir': {
        description: 'Create a directory',
        inputSchema: z.object({
            path: z.string().min(1).describe('Directory path to create'),
            recursive: z.boolean().optional().describe('Create parent directories if needed (default: true)'),
        }),
        execute: async ({ path: filePath, recursive = true }: { path: string; recursive?: boolean }) => {
            try {
                return await files.mkdir(filePath, recursive);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'file-rename': {
        description: 'Rename or move a file or directory',
        inputSchema: z.object({
            from: z.string().min(1).describe('Source path'),
            to: z.string().min(1).describe('Destination path'),
            overwrite: z.boolean().optional().describe('Overwrite destination if it exists (default: false)'),
        }),
        execute: async ({ from, to, overwrite = false }: { from: string; to: string; overwrite?: boolean }) => {
            try {
                return await files.rename(from, to, overwrite);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'file-copy': {
        description: 'Copy a file (directories not supported)',
        inputSchema: z.object({
            from: z.string().min(1).describe('Source file path'),
            to: z.string().min(1).describe('Destination file path'),
            overwrite: z.boolean().optional().describe('Overwrite destination if it exists (default: false)'),
        }),
        execute: async ({ from, to, overwrite = false }: { from: string; to: string; overwrite?: boolean }) => {
            try {
                return await files.copy(from, to, overwrite);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'file-remove': {
        description: 'Remove a file or directory. Files are moved to the Rowboat trash by default for safety.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Path to remove'),
            recursive: z.boolean().optional().describe('Required for directories (default: false)'),
            trash: z.boolean().optional().describe('Move to trash instead of permanent delete (default: true)'),
        }),
        execute: async ({ path: filePath, recursive, trash }: { path: string; recursive?: boolean; trash?: boolean }) => {
            try {
                return await files.remove(filePath, {
                    recursive,
                    trash,
                });
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'file-glob': {
        description: 'Find files matching a glob pattern (e.g., "**/*.ts", "src/**/*.json"). Much faster than recursive readdir for finding files.',
        inputSchema: z.object({
            pattern: z.string().describe('Glob pattern to match files'),
            cwd: z.string().optional().describe('Directory to search in (default: default root)'),
        }),
        execute: async ({ pattern, cwd }: { pattern: string; cwd?: string }) => {
            try {
                return await files.glob(pattern, cwd);
            } catch (error) {
                return { error: error instanceof Error ? error.message : 'Unknown error' };
            }
        },
    },

    'file-grep': {
        description: 'Search text file contents using regex. Returns matching files and lines. Skips binary files.',
        inputSchema: z.object({
            pattern: z.string().describe('Regex pattern to search for'),
            searchPath: z.string().optional().describe('Directory or file to search (default: default root)'),
            fileGlob: z.string().optional().describe('File pattern filter (e.g., "*.ts", "*.md")'),
            contextLines: z.number().optional().describe('Lines of context around matches (default: 0)'),
            maxResults: z.number().optional().describe('Maximum results to return (default: 100)'),
        }),
        execute: async ({
            pattern,
            searchPath,
            fileGlob,
            contextLines = 0,
            maxResults = 100
        }: {
            pattern: string;
            searchPath?: string;
            fileGlob?: string;
            contextLines?: number;
            maxResults?: number;
        }) => {
            try {
                return await files.grep({ pattern, searchPath, fileGlob, contextLines, maxResults });
            } catch (error) {
                return { error: error instanceof Error ? error.message : 'Unknown error' };
            }
        },
    },

    'parseFile': {
        description: 'Parse and extract text content from files (PDF, Excel, CSV, Word .docx). Auto-detects format from file extension.',
        inputSchema: z.object({
            path: z.string().min(1).describe('File path to parse. Can be absolute, ~/..., or relative to the default root.'),
        }),
        execute: async ({ path: filePath }: { path: string }) => {
            try {
                const fileName = path.basename(filePath);
                const ext = path.extname(filePath).toLowerCase();
                const supportedExts = ['.pdf', '.xlsx', '.xls', '.csv', '.docx'];

                if (!supportedExts.includes(ext)) {
                    return {
                        success: false,
                        error: `Unsupported file format '${ext}'. Supported formats: ${supportedExts.join(', ')}`,
                    };
                }

                const { buffer, resolvedPath } = await files.readBuffer(filePath);

                if (ext === '.pdf') {
                    const { PDFParse } = await _importDynamic("pdf-parse");
                    const parser = new PDFParse({ data: new Uint8Array(buffer) });
                    try {
                        const textResult = await parser.getText();
                        const infoResult = await parser.getInfo();
                        return {
                            success: true,
                            fileName,
                            format: 'pdf',
                            content: textResult.text,
                            metadata: {
                                pages: textResult.total,
                                title: infoResult.info?.Title || undefined,
                                author: infoResult.info?.Author || undefined,
                                resolvedPath,
                            },
                        };
                    } finally {
                        await parser.destroy();
                    }
                }

                if (ext === '.xlsx' || ext === '.xls') {
                    const XLSX = await _importDynamic("xlsx");
                    const workbook = XLSX.read(buffer, { type: 'buffer' });
                    const sheets: Record<string, string> = {};
                    for (const sheetName of workbook.SheetNames) {
                        const sheet = workbook.Sheets[sheetName];
                        sheets[sheetName] = XLSX.utils.sheet_to_csv(sheet);
                    }
                    return {
                        success: true,
                        fileName,
                        format: ext === '.xlsx' ? 'xlsx' : 'xls',
                        content: Object.values(sheets).join('\n\n'),
                        metadata: {
                            sheetNames: workbook.SheetNames,
                            sheetCount: workbook.SheetNames.length,
                        },
                        sheets,
                    };
                }

                if (ext === '.csv') {
                    const Papa = (await _importDynamic("papaparse")).default;
                    const text = buffer.toString('utf8');
                    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
                    return {
                        success: true,
                        fileName,
                        format: 'csv',
                        content: text,
                        metadata: {
                            rowCount: parsed.data.length,
                            headers: parsed.meta.fields || [],
                        },
                        data: parsed.data,
                    };
                }

                if (ext === '.docx') {
                    const mammoth = (await _importDynamic("mammoth")).default;
                    const docResult = await mammoth.extractRawText({ buffer });
                    return {
                        success: true,
                        fileName,
                        format: 'docx',
                        content: docResult.value,
                    };
                }

                return { success: false, error: 'Unexpected error' };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'LLMParse': {
        description: 'Send a file to the configured LLM as a multimodal attachment and ask it to extract content as markdown. Best for scanned PDFs, images with text, complex layouts, or any format where local parsing falls short. Supports documents (PDF, Word, Excel, PowerPoint, CSV, TXT, HTML) and images (PNG, JPG, GIF, WebP, SVG, BMP, TIFF).',
        inputSchema: z.object({
            path: z.string().min(1).describe('File path to parse. Can be absolute, ~/..., or relative to the default root.'),
            prompt: z.string().optional().describe('Custom instruction for the LLM (defaults to "Convert this file to well-structured markdown.")'),
        }),
        execute: async ({ path: filePath, prompt }: { path: string; prompt?: string }) => {
            try {
                const fileName = path.basename(filePath);
                const ext = path.extname(filePath).toLowerCase();
                const mimeType = LLMPARSE_MIME_TYPES[ext];

                if (!mimeType) {
                    return {
                        success: false,
                        error: `Unsupported file format '${ext}'. Supported formats: ${Object.keys(LLMPARSE_MIME_TYPES).join(', ')}`,
                    };
                }

                const { buffer } = await files.readBuffer(filePath);

                const base64 = buffer.toString('base64');

                const { model: modelId, provider: providerName } = await getDefaultModelAndProvider();
                const providerConfig = await resolveProviderConfig(providerName);
                const model = createProvider(providerConfig).languageModel(modelId);

                const userPrompt = prompt || 'Convert this file to well-structured markdown.';

                const ctx = getCurrentUseCase();
                const response = await withUseCase({
                    useCase: ctx?.useCase ?? 'copilot_chat',
                    subUseCase: 'file_parse',
                    ...(ctx?.agentName ? { agentName: ctx.agentName } : {}),
                }, () => generateText({
                    model,
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: userPrompt },
                                { type: 'file', data: base64, mediaType: mimeType },
                            ],
                        },
                    ],
                }));

                captureLlmUsage({
                    useCase: ctx?.useCase ?? 'copilot_chat',
                    subUseCase: 'file_parse',
                    ...(ctx?.agentName ? { agentName: ctx.agentName } : {}),
                    model: modelId,
                    provider: providerName,
                    usage: response.usage,
                });

                return {
                    success: true,
                    fileName,
                    format: ext.slice(1),
                    mimeType,
                    content: response.text,
                    usage: response.usage,
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    analyzeAgent: {
        description: 'Read and analyze an agent file to understand its structure, tools, and configuration',
        inputSchema: z.object({
            agentName: z.string().describe('Name of the agent file to analyze (with or without .json extension)'),
        }),
        execute: async ({ agentName }: { agentName: string }) => {
            const repo = container.resolve<IAgentsRepo>('agentsRepo');
            try {
                const agent = await repo.fetch(agentName);
                
                // Extract key information
                const toolsList = agent.tools ? Object.keys(agent.tools) : [];
                const agentTools = agent.tools ? Object.entries(agent.tools).map(([key, tool]) => ({
                    key,
                    type: tool.type,
                    name: tool.name,
                })) : [];
                
                const analysis = {
                    name: agent.name,
                    description: agent.description || 'No description',
                    model: agent.model || 'Not specified',
                    toolCount: toolsList.length,
                    tools: agentTools,
                    hasOtherAgents: agentTools.some(t => t.type === 'agent'),
                    structure: agent,
                };
                
                return {
                    success: true,
                    analysis,
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Failed to analyze agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    addMcpServer: {
        description: 'Add or update an MCP server in the configuration with validation. This ensures the server definition is valid before saving.',
        inputSchema: z.object({
            serverName: z.string().describe('Name/alias for the MCP server'),
            config: McpServerDefinition,
        }),
        execute: async ({ serverName, config }: { 
            serverName: string;
            config: z.infer<typeof McpServerDefinition>;
        }) => {
            try {
                const validationResult = McpServerDefinition.safeParse(config);
                if (!validationResult.success) {
                    return {
                        success: false,
                        message: 'Server definition failed validation. Check the errors below.',
                        validationErrors: validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
                        providedDefinition: config,
                    };
                }

                const repo = container.resolve<IMcpConfigRepo>('mcpConfigRepo');
                await repo.upsert(serverName, config);
                
                return {
                    success: true,
                    serverName,
                };
            } catch (error) {
                return {
                    error: `Failed to update MCP server: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    listMcpServers: {
        description: 'List all available MCP servers from the configuration',
        inputSchema: z.object({}),
        execute: async () => {
            try {
                const result = await listServers();
                
                return {
                    result,
                    count: Object.keys(result.mcpServers).length,
                };
            } catch (error) {
                return {
                    error: `Failed to list MCP servers: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    listMcpTools: {
        description: 'List all available tools from a specific MCP server',
        inputSchema: z.object({
            serverName: z.string().describe('Name of the MCP server to query'),
            cursor: z.string().optional(),
        }),
        execute: async ({ serverName, cursor }: { serverName: string, cursor?: string }) => {
            try {
                const result = await listTools(serverName, cursor);
                return {
                    serverName,
                    result,
                    count: result.tools.length,
                };
            } catch (error) {
                return {
                    error: `Failed to list MCP tools: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    executeMcpTool: {
        description: 'Execute a specific tool from an MCP server. Use this to run MCP tools on behalf of the user. IMPORTANT: Always use listMcpTools first to get the tool\'s inputSchema, then match the required parameters exactly in the arguments field.',
        inputSchema: z.object({
            serverName: z.string().describe('Name of the MCP server that provides the tool'),
            toolName: z.string().describe('Name of the tool to execute'),
            arguments: z.record(z.string(), z.any()).optional().describe('Arguments to pass to the tool (as key-value pairs matching the tool\'s input schema). MUST include all required parameters from the tool\'s inputSchema.'),
        }),
        execute: async ({ serverName, toolName, arguments: args = {} }: { serverName: string, toolName: string, arguments?: Record<string, unknown> }) => {
            try {
                const result = await executeTool(serverName, toolName, args);
                return {
                    success: true,
                    serverName,
                    toolName,
                    result,
                    message: `Successfully executed tool '${toolName}' from server '${serverName}'`,
                };
            } catch (error) {
                return {
                    success: false,
                    error: `Failed to execute MCP tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    hint: 'Use listMcpTools to verify the tool exists and check its schema. Ensure all required parameters are provided in the arguments field.',
                };
            }
        },
    },
    
    executeCommand: {
        description: 'Execute a shell command and return the output. Use this to run bash/shell commands.',
        inputSchema: z.object({
            command: z.string().describe('The shell command to execute (e.g., "ls -la", "cat file.txt")'),
            cwd: z.string().optional().describe('Working directory to execute the command in (defaults to workspace root). You do not need to set this unless absolutely necessary.'),
        }),
        execute: async ({ command, cwd }: { command: string, cwd?: string }, ctx?: ToolContext) => {
            try {
                const rootDir = path.resolve(WorkDir);
                const workingDir = cwd ? path.resolve(rootDir, cwd) : rootDir;
                // Make `agent-slack` resolvable for skill-authored shell
                // commands; the shim forwards to the bundled CLI.
                const env = agentSlackShimEnv(path.join(rootDir, 'bin'));

                // TODO: Re-enable this check
                // const rootPrefix = rootDir.endsWith(path.sep)
                //     ? rootDir
                //     : `${rootDir}${path.sep}`;
                // if (workingDir !== rootDir && !workingDir.startsWith(rootPrefix)) {
                //     return {
                //         success: false,
                //         message: 'Invalid cwd: must be within workspace root.',
                //         command,
                //         workingDir,
                //     };
                // }

                // Use abortable version when we have a signal
                if (ctx?.signal) {
                    const { promise, process: proc } = executeCommandAbortable(command, {
                        cwd: workingDir,
                        env,
                        signal: ctx.signal,
                        onData: (chunk: string) => {
                            ctx.publish({
                                runId: ctx.runId,
                                type: "tool-output-stream",
                                toolCallId: ctx.toolCallId,
                                toolName: "executeCommand",
                                output: chunk,
                                subflow: [],
                            });
                        },
                    });

                    // Register process with abort registry for force-kill
                    ctx.abortRegistry.registerProcess(ctx.runId, proc);

                    const result = await promise;

                    return {
                        success: result.exitCode === 0 && !result.wasAborted,
                        stdout: result.stdout,
                        stderr: result.stderr,
                        exitCode: result.exitCode,
                        wasAborted: result.wasAborted,
                        command,
                        workingDir,
                    };
                }

                // Fallback to original for backward compatibility
                const result = await executeCommand(command, { cwd: workingDir, env });

                return {
                    success: result.exitCode === 0,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    exitCode: result.exitCode,
                    command,
                    workingDir,
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Failed to execute command: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    command,
                };
            }
        },
    },

    code_agent_run: {
        description: 'Run a coding/software task with the selected on-device coding agent (Claude Code or Codex) inside a project folder. Streams the agent\'s tool calls, file diffs, and plan into the chat and surfaces permission requests inline. Use this for ALL code-mode work (writing/editing/reading code, running tests, debugging, exploring a repo). Reuses one persistent session per chat, so follow-up requests keep context.',
        inputSchema: z.object({
            agent: z.enum(['claude', 'codex']).describe('Which coding agent to use: "claude" (Claude Code) or "codex". Set this to the active code-mode chip agent. Note: when the chip is set, the backend uses the chip agent regardless of this value — this only takes effect in the ask-human flow where no chip is set.'),
            cwd: z.string().describe('Absolute path to the working directory / project folder the agent should operate in.'),
            prompt: z.string().describe('The full, self-contained coding instruction for the agent (file names, expected behavior, constraints).'),
        }),
        execute: async ({ agent, cwd, prompt }: { agent: 'claude' | 'codex', cwd: string, prompt: string }, ctx?: ToolContext) => {
            if (!ctx) {
                return { success: false, message: 'code_agent_run requires run context (runId / streaming).' };
            }
            // The composer chip is the source of truth for the agent. The model's `agent`
            // argument is only a fallback for the ask-human flow (code mode not active, no
            // chip set) — otherwise it can anchor on the thread's earlier agent and ignore a
            // chip change. Honor the chip so switching it deterministically switches agents.
            const effectiveAgent = ctx.codeMode ?? agent;
            // Code-section sessions pin the working directory — never trust the model's
            // cwd argument over the session's.
            const effectiveCwd = ctx.codeCwd ?? cwd;
            const manager = container.resolve<CodeModeManager>('codeModeManager');
            const registry = container.resolve<CodePermissionRegistry>('codePermissionRegistry');

            // Approval policy: the session's (Code section) wins, else global settings,
            // else default to asking the user.
            let policy: ApprovalPolicy = 'ask';
            if (ctx.codePolicy) {
                policy = ctx.codePolicy;
            } else {
                try {
                    const cfg = await container.resolve<ICodeModeConfigRepo>('codeModeConfigRepo').getConfig();
                    if (cfg.approvalPolicy) policy = cfg.approvalPolicy;
                } catch {
                    // fall back to 'ask'
                }
            }

            // On stop, unblock any pending approval card so the broker stops waiting for
            // an answer that will never come. The ACP cancel + force-kill backstop that
            // actually ends the turn is handled inside manager.runPrompt via the signal
            // we pass below.
            const onAbort = () => registry.cancelRun(ctx.runId);
            if (ctx.signal.aborted) onAbort();
            else ctx.signal.addEventListener('abort', onAbort, { once: true });

            let finalText = '';
            const changedFiles = new Set<string>();
            try {
                const result = await manager.runPrompt({
                    runId: ctx.runId,
                    agent: effectiveAgent,
                    cwd: effectiveCwd,
                    prompt,
                    policy,
                    signal: ctx.signal,
                    onEvent: (event) => {
                        if (event.type === 'message' && event.role === 'agent') finalText += event.text;
                        if (event.type === 'tool_call_update') for (const f of event.diffs) changedFiles.add(f);
                        void ctx.publish({
                            runId: ctx.runId,
                            type: 'code-run-event',
                            toolCallId: ctx.toolCallId,
                            event,
                            subflow: [],
                        });
                    },
                    ask: (permAsk) => registry.request(ctx.runId, (requestId) => {
                        void ctx.publish({
                            runId: ctx.runId,
                            type: 'code-run-permission-request',
                            toolCallId: ctx.toolCallId,
                            requestId,
                            ask: permAsk,
                            subflow: [],
                        });
                    }),
                });
                return {
                    success: result.stopReason === 'end_turn',
                    stopReason: result.stopReason,
                    // The agent that actually ran (the chip), so the UI can label the run
                    // authoritatively rather than trusting the model's `agent` argument.
                    agent: effectiveAgent,
                    summary: finalText.trim(),
                    changedFiles: [...changedFiles],
                };
            } catch (error) {
                // A stop mid-run isn't a failure — report it as a clean cancellation.
                if (ctx.signal.aborted) {
                    return {
                        success: false,
                        stopReason: 'cancelled',
                        agent: effectiveAgent,
                        summary: finalText.trim(),
                        changedFiles: [...changedFiles],
                    };
                }
                return {
                    success: false,
                    message: `Coding agent failed: ${error instanceof Error ? error.message : String(error)}`,
                };
            } finally {
                ctx.signal.removeEventListener('abort', onAbort);
            }
        },
    },

    // ============================================================================
    // Browser Skills (browser-use/browser-harness domain-skills cache)
    // ============================================================================

    'load-browser-skill': {
        description: 'Load a site-specific browser skill (from the browser-use/browser-harness domain-skills library) by id. Returns the full markdown content with selectors, gotchas, and recipes for the target site. Call this after browser-control responses surface a matching skill in suggestedSkills. Pass action="list" to see all available skills. Skills are fetched on first use and cached locally; pass action="refresh" to force an update from upstream.',
        inputSchema: z.object({
            action: z.enum(['load', 'list', 'refresh']).optional().describe('load: fetch a skill by id (default). list: list all cached skills. refresh: re-fetch the library from upstream.'),
            id: z.string().optional().describe('Skill id (e.g., "github/repo-actions") — required for load.'),
            site: z.string().optional().describe('Filter list results to a single site (e.g., "github").'),
        }),
        execute: async (input: { action?: 'load' | 'list' | 'refresh'; id?: string; site?: string }) => {
            const action = input.action ?? 'load';
            try {
                if (action === 'refresh') {
                    const index = await refreshBrowserSkills();
                    return {
                        success: true,
                        message: `Refreshed ${index.entries.length} skill${index.entries.length === 1 ? '' : 's'} from upstream.`,
                        count: index.entries.length,
                        treeSha: index.treeSha,
                    };
                }

                if (action === 'list') {
                    const status = await ensureBrowserSkillsLoaded();
                    if (status.status === 'error') {
                        return { success: false, error: status.error };
                    }
                    if (status.status === 'empty') {
                        return { success: false, error: 'No browser skills cached yet.' };
                    }
                    const entries = status.index.entries
                        .filter((e) => !input.site || e.site === input.site)
                        .map((e) => ({ id: e.id, title: e.title, site: e.site }));
                    return {
                        success: true,
                        count: entries.length,
                        skills: entries,
                        cacheAgeMs: Date.now() - status.index.fetchedAt,
                        refreshing: status.status === 'stale' ? status.refreshing : false,
                    };
                }

                if (!input.id) {
                    return { success: false, error: 'id is required for load.' };
                }
                const result = await readBrowserSkillContent(input.id);
                if (!result.ok) {
                    return { success: false, error: result.error };
                }
                return {
                    success: true,
                    id: result.entry.id,
                    title: result.entry.title,
                    site: result.entry.site,
                    path: result.entry.path,
                    content: result.content,
                };
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : 'Failed to load browser skill.' };
            }
        },
    },

    // ============================================================================
    // Browser Control
    // ============================================================================

    'browser-control': {
        description: 'Control the embedded browser pane. Read the current page, inspect indexed interactable elements, and navigate/click/type/press keys in the active browser tab.',
        inputSchema: BrowserControlInputSchema,
        isAvailable: async () => {
            try {
                container.resolve<IBrowserControlService>('browserControlService');
                return true;
            } catch {
                return false;
            }
        },
        execute: async (input: BrowserControlInput, ctx?: ToolContext) => {
            try {
                const browserControlService = container.resolve<IBrowserControlService>('browserControlService');
                return await browserControlService.execute(input, { signal: ctx?.signal });
            } catch (error) {
                return {
                    success: false,
                    action: input.action,
                    error: error instanceof Error ? error.message : 'Browser control is unavailable.',
                    browser: {
                        activeTabId: null,
                        tabs: [],
                    },
                };
            }
        },
    },

    // ============================================================================
    // App Navigation
    // ============================================================================

    'app-navigation': {
        description: 'Control the app UI - navigate to notes, switch views, filter/search the knowledge base, and manage saved views.',
        inputSchema: z.object({
            action: z.enum(["open-note", "open-view", "update-base-view", "get-base-state", "create-base"]).describe("The navigation action to perform"),
            // open-note
            path: z.string().optional().describe("Knowledge file path for open-note, e.g. knowledge/People/John.md"),
            // open-view
            view: z.enum(["bases", "graph"]).optional().describe("Which view to open (for open-view action)"),
            // update-base-view
            filters: z.object({
                set: z.array(z.object({ category: z.string(), value: z.string() })).optional().describe("Replace all filters with these"),
                add: z.array(z.object({ category: z.string(), value: z.string() })).optional().describe("Add these filters"),
                remove: z.array(z.object({ category: z.string(), value: z.string() })).optional().describe("Remove these filters"),
                clear: z.boolean().optional().describe("Clear all filters"),
            }).optional().describe("Filter modifications (for update-base-view)"),
            columns: z.object({
                set: z.array(z.string()).optional().describe("Replace visible columns with these"),
                add: z.array(z.string()).optional().describe("Add these columns"),
                remove: z.array(z.string()).optional().describe("Remove these columns"),
            }).optional().describe("Column modifications (for update-base-view)"),
            sort: z.object({
                field: z.string(),
                dir: z.enum(["asc", "desc"]),
            }).optional().describe("Sort configuration (for update-base-view)"),
            search: z.string().optional().describe("Search query to filter notes (for update-base-view)"),
            // get-base-state
            base_name: z.string().optional().describe("Name of a saved base to inspect (for get-base-state). Omit for the current/default view."),
            // create-base
            name: z.string().optional().describe("Name for the saved base view (for create-base)"),
        }),
        execute: async (input: {
            action: string;
            [key: string]: unknown;
        }) => {
            switch (input.action) {
                case 'open-note': {
                    const filePath = input.path as string;
                    try {
                        const result = await files.exists(filePath);
                        if (!result.exists) {
                            return { success: false, error: `File not found: ${filePath}` };
                        }
                        return { success: true, action: 'open-note', path: filePath };
                    } catch {
                        return { success: false, error: `Could not access file: ${filePath}` };
                    }
                }

                case 'open-view': {
                    const view = input.view as string;
                    return { success: true, action: 'open-view', view };
                }

                case 'update-base-view': {
                    const updates: Record<string, unknown> = {};
                    if (input.filters) updates.filters = input.filters;
                    if (input.columns) updates.columns = input.columns;
                    if (input.sort) updates.sort = input.sort;
                    if (input.search !== undefined) updates.search = input.search;
                    return { success: true, action: 'update-base-view', updates };
                }

                case 'get-base-state': {
                    // Scan knowledge/ files and extract frontmatter properties
                    try {
                        const { parseFrontmatter } = await import("@x/shared/dist/frontmatter.js");
                        const entries = await files.list("knowledge", { recursive: true, allowedExtensions: [".md"] });
                        const noteFiles = entries.filter(e => e.kind === 'file');
                        const properties = new Map<string, Set<string>>();
                        let noteCount = 0;

                        for (const file of noteFiles) {
                            try {
                                const result = await fs.readFile(file.resolvedPath, 'utf8');
                                const { fields } = parseFrontmatter(result);
                                noteCount++;
                                for (const [key, value] of Object.entries(fields)) {
                                    if (!value) continue;
                                    let set = properties.get(key);
                                    if (!set) { set = new Set(); properties.set(key, set); }
                                    const values = Array.isArray(value) ? value : [value];
                                    for (const v of values) {
                                        const trimmed = v.trim();
                                        if (trimmed) set.add(trimmed);
                                    }
                                }
                            } catch {
                                // skip unreadable files
                            }
                        }

                        const availableProperties: Record<string, string[]> = {};
                        for (const [key, values] of properties) {
                            availableProperties[key] = [...values].sort();
                        }

                        return {
                            success: true,
                            action: 'get-base-state',
                            noteCount,
                            availableProperties,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: error instanceof Error ? error.message : 'Failed to read knowledge base',
                        };
                    }
                }

                case 'create-base': {
                    const name = input.name as string;
                    const safeName = name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
                    if (!safeName) {
                        return { success: false, error: 'Invalid base name' };
                    }
                    const basePath = `bases/${safeName}.base`;
                    try {
                        const config = { name: safeName, filters: [], columns: [] };
                        await files.writeText(basePath, JSON.stringify(config, null, 2), { mkdirp: true });
                        return { success: true, action: 'create-base', name: safeName, path: basePath };
                    } catch (error) {
                        return {
                            success: false,
                            error: error instanceof Error ? error.message : 'Failed to create base',
                        };
                    }
                }

                default:
                    return { success: false, error: `Unknown action: ${input.action}` };
            }
        },
    },

    // ============================================================================
    // Web Search (Exa Search API)
    // ============================================================================

    'web-search': {
        description: 'Search the web for articles, blog posts, papers, companies, people, news, or explore a topic in depth. Returns rich results with full text, highlights, and metadata.',
        inputSchema: z.object({
            query: z.string().describe('The search query'),
            numResults: z.number().optional().describe('Number of results to return (default: 5, max: 20)'),
            category: z.enum(['general', 'company', 'research paper', 'news', 'tweet', 'personal site', 'financial report', 'people']).optional().describe('Search category. Defaults to "general" which searches the entire web. Only use a specific category when the query is clearly about that type (e.g. "research paper" for academic papers, "company" for company info). For everyday queries like weather, restaurants, prices, how-to, etc., use "general" or omit entirely.'),
        }),
        isAvailable: async () => {
            if (await isSignedIn()) return true;
            try {
                const exaConfigPath = path.join(WorkDir, 'config', 'exa-search.json');
                const raw = await fs.readFile(exaConfigPath, 'utf8');
                const config = JSON.parse(raw);
                return !!config.apiKey;
            } catch {
                return false;
            }
        },
        execute: async ({ query, numResults, category }: { query: string; numResults?: number; category?: string }) => {
            try {
                const resultCount = Math.min(Math.max(numResults || 5, 1), 20);

                const reqBody: Record<string, unknown> = {
                    query,
                    numResults: resultCount,
                    type: 'auto',
                    contents: {
                        text: { maxCharacters: 1000 },
                        highlights: true,
                    },
                };
                if (category && category !== 'general') {
                    reqBody.category = category;
                }

                let response: Response;

                if (await isSignedIn()) {
                    // Use proxy
                    const accessToken = await getAccessToken();
                    response = await fetch(`${API_URL}/v1/search/exa`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(reqBody),
                    });
                } else {
                    // Read API key from config
                    const exaConfigPath = path.join(WorkDir, 'config', 'exa-search.json');

                    let apiKey: string;
                    try {
                        const raw = await fs.readFile(exaConfigPath, 'utf8');
                        const config = JSON.parse(raw);
                        apiKey = config.apiKey;
                    } catch {
                        return {
                            success: false,
                            error: `Exa Search API key not configured. Create ${exaConfigPath} with { "apiKey": "<your-key>" }`,
                        };
                    }

                    if (!apiKey) {
                        return {
                            success: false,
                            error: `Exa Search API key is empty. Set "apiKey" in ${exaConfigPath}`,
                        };
                    }

                    response = await fetch('https://api.exa.ai/search', {
                        method: 'POST',
                        headers: {
                            'x-api-key': apiKey,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(reqBody),
                    });
                }

                if (!response.ok) {
                    const text = await response.text();
                    return {
                        success: false,
                        error: `Exa Search API error (${response.status}): ${text}`,
                    };
                }

                const data = await response.json() as {
                    results?: Array<{
                        title?: string;
                        url?: string;
                        publishedDate?: string;
                        author?: string;
                        highlights?: string[];
                        text?: string;
                    }>;
                };

                const results = (data.results || []).map((r) => ({
                    title: r.title || '',
                    url: r.url || '',
                    publishedDate: r.publishedDate || '',
                    author: r.author || '',
                    highlights: r.highlights || [],
                    text: r.text || '',
                }));

                return {
                    success: true,
                    query,
                    results,
                    count: results.length,
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },
    'save-to-memory': {
        description: "Save a note about the user to the agent memory inbox. Use this when you observe something worth remembering — their preferences, communication patterns, relationship context, scheduling habits, or explicit instructions about how they want things done.",
        inputSchema: z.object({
            note: z.string().describe("The observation or preference to remember. Be specific and concise."),
        }),
        execute: async ({ note }: { note: string }) => {
            const inboxPath = path.join(WorkDir, 'knowledge', 'Agent Notes', 'inbox.md');
            const dir = path.dirname(inboxPath);
            await fs.mkdir(dir, { recursive: true });

            const timestamp = new Date().toISOString();
            const entry = `\n- [${timestamp}] ${note}\n`;

            await fs.appendFile(inboxPath, entry, 'utf-8');

            return {
                success: true,
                message: `Saved to memory: ${note}`,
            };
        },
    },

    // ========================================================================
    // Composio Meta-Tools
    // ========================================================================

    'composio-list-toolkits': {
        description: 'List available Composio integrations (Gmail, Slack, GitHub, etc.) and their connection status. Use this to show the user what services they can connect to.',
        inputSchema: z.object({
            category: z.enum(['all', 'communication', 'productivity', 'development', 'crm', 'social', 'storage', 'support']).optional()
                .describe('Filter by category. Defaults to "all".'),
        }),
        execute: async ({ category }: { category?: string }) => {
            const toolkits = CURATED_TOOLKITS
                .filter(t => !category || category === 'all' || t.category === category)
                .map(t => ({
                    slug: t.slug,
                    name: t.displayName,
                    category: t.category,
                    isConnected: composioAccountsRepo.isConnected(t.slug),
                }));

            const connectedCount = toolkits.filter(t => t.isConnected).length;
            return {
                toolkits,
                connectedCount,
                totalCount: toolkits.length,
            };
        },
        isAvailable: async () => isComposioConfigured(),
    },

    'composio-search-tools': {
        description: 'Search for Composio tools by use case across connected services. Returns tool slugs, descriptions, and input schemas so you can call composio-execute-tool with the right parameters. Example: search "send email" to find Gmail tools, "create issue" to find GitHub/Jira tools.',
        inputSchema: z.object({
            query: z.string().describe('Natural language description of what you want to do (e.g., "send an email", "create a GitHub issue", "schedule a meeting")'),
            toolkitSlug: z.string().optional().describe('Optional: limit search to a specific toolkit (e.g., "gmail", "github")'),
        }),
        execute: async ({ query, toolkitSlug }: { query: string; toolkitSlug?: string }) => {
            try {
                const toolkitFilter = toolkitSlug ? [toolkitSlug] : undefined;
                const result = await searchComposioTools(query, toolkitFilter);

                // Filter to curated toolkits only (skip if a specific toolkit was requested —
                // the API already filtered server-side)
                const filtered = toolkitSlug
                    ? result.items
                    : result.items.filter(t => CURATED_TOOLKIT_SLUGS.has(t.toolkitSlug));

                // Annotate with connection status
                const tools = filtered.map(t => ({
                    slug: t.slug,
                    name: t.name,
                    description: t.description,
                    toolkitSlug: t.toolkitSlug,
                    isConnected: composioAccountsRepo.isConnected(t.toolkitSlug),
                    inputSchema: t.inputParameters,
                }));

                return {
                    tools,
                    resultCount: tools.length,
                    hint: tools.some(t => !t.isConnected)
                        ? 'Some tools require connecting the toolkit first. Use composio-connect-toolkit to help the user authenticate.'
                        : undefined,
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { tools: [], resultCount: 0, error: message };
            }
        },
        isAvailable: async () => isComposioConfigured(),
    },

    'composio-execute-tool': {
        description: 'Execute a Composio tool by its slug. You MUST pass the arguments field with all required parameters from the search results inputSchema. Example: composio-execute-tool({ toolSlug: "GITHUB_ISSUES_LIST_FOR_REPO", toolkitSlug: "github", arguments: { owner: "rowboatlabs", repo: "rowboat", state: "open", per_page: 100 } })',
        inputSchema: z.object({
            toolSlug: z.string().describe('EXACT tool slug from search results (e.g., "GITHUB_ISSUES_LIST_FOR_REPO"). Copy it exactly — do not modify it.'),
            toolkitSlug: z.string().describe('The toolkit slug (e.g., "gmail", "github")'),
            arguments: z.record(z.string(), z.unknown()).describe('REQUIRED: Tool input parameters as key-value pairs. Get the required fields from the inputSchema returned by composio-search-tools. Never omit this.'),
        }),
        execute: async ({ toolSlug, toolkitSlug, arguments: args }: { toolSlug: string; toolkitSlug: string; arguments?: Record<string, unknown> }) => {
            // Default arguments to {} if the LLM omits the field entirely
            const toolArgs = args ?? {};

            // Check connection
            const account = composioAccountsRepo.getAccount(toolkitSlug);
            if (!account || account.status !== 'ACTIVE') {
                return {
                    successful: false,
                    data: null,
                    error: `Toolkit "${toolkitSlug}" is not connected. Use composio-connect-toolkit to help the user connect it first.`,
                };
            }

            try {
                return await executeComposioAction(toolSlug, {
                    connected_account_id: account.id,
                    user_id: 'rowboat-user',
                    version: 'latest',
                    arguments: toolArgs,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[Composio] Tool execution failed for ${toolSlug}:`, message);
                return {
                    successful: false,
                    data: null,
                    error: `Failed to execute ${toolSlug}: ${message}. If fields are missing, check the inputSchema and retry with the correct arguments.`,
                };
            }
        },
        isAvailable: async () => isComposioConfigured(),
    },

    'composio-connect-toolkit': {
        description: 'Connect a Composio service (Gmail, Slack, GitHub, etc.) via OAuth. Shows a connect card for the user to authenticate.',
        inputSchema: z.object({
            toolkitSlug: z.string().describe('The toolkit slug to connect (e.g., "gmail", "github", "slack", "notion")'),
        }),
        execute: async ({ toolkitSlug }: { toolkitSlug: string }) => {
            // Validate against curated list
            if (!CURATED_TOOLKIT_SLUGS.has(toolkitSlug)) {
                const available = CURATED_TOOLKITS.map(t => `${t.slug} (${t.displayName})`).join(', ');
                return {
                    success: false,
                    error: `Unknown toolkit "${toolkitSlug}". Available toolkits: ${available}`,
                };
            }

            // Check if already connected
            if (composioAccountsRepo.isConnected(toolkitSlug)) {
                return {
                    success: true,
                    message: `${toolkitSlug} is already connected. You can search for and execute its tools.`,
                    alreadyConnected: true,
                };
            }

            // Return signal — the UI renders a ComposioConnectCard with a Connect button.
            // OAuth only starts when the user clicks that button.
            const toolkit = CURATED_TOOLKITS.find(t => t.slug === toolkitSlug);
            return {
                success: true,
                message: `Please connect ${toolkit?.displayName ?? toolkitSlug} to continue.`,
            };
        },
        isAvailable: async () => isComposioConfigured(),
    },
    'mini-app-install': {
        description: "Install or update a Mini App on disk at ~/.rowboat/apps/<id>/. Writes manifest.json + dist/index.html (and optional initial data.json). Use this to materialize an app you built — do NOT hand-write these files with file tools. The HTML must be self-contained and include the bridge via <script src=\"/__bridge__.js\"></script>, coding against window.rowboat. After install, the app shows up in the Mini Apps gallery.",
        inputSchema: z.object({
            manifest: MiniAppManifest,
            html: z.string().describe('Full self-contained HTML for dist/index.html.'),
            data: z.unknown().optional().describe('Optional initial data.json content (only written if no data.json exists yet).'),
        }),
        execute: async ({ manifest, html, data }: { manifest: z.infer<typeof MiniAppManifest>; html: string; data?: unknown }) => {
            try {
                const m = MiniAppManifest.parse(manifest);
                const dir = path.join(WorkDir, 'apps', m.id);
                const dist = path.join(dir, 'dist');
                await fs.mkdir(dist, { recursive: true });
                await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
                await fs.writeFile(path.join(dist, 'index.html'), html);
                if (data !== undefined) {
                    const dataPath = path.join(dir, 'data.json');
                    try { await fs.access(dataPath); } catch { await fs.writeFile(dataPath, JSON.stringify(data, null, 2)); }
                }
                return { success: true, id: m.id, url: `app://miniapp/${m.id}/index.html` };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
    'mini-app-set-data': {
        description: "Write a Mini App's data.json — the JSON its frontend reads via rowboat.getData/onData. The path is derived from appId and the write is atomic (temp→rename), so you only supply the content. This is how a background task refreshes an app's data; the agent returns the data, the write is deterministic.",
        inputSchema: z.object({
            appId: z.string().describe('The app id (folder name under ~/.rowboat/apps).'),
            data: z.unknown().describe('Full data payload to store as data.json (matching the app data schema).'),
        }),
        execute: async ({ appId, data }: { appId: string; data: unknown }) => {
            try {
                const dir = path.join(WorkDir, 'apps', appId);
                await fs.mkdir(dir, { recursive: true });
                const dataPath = path.join(dir, 'data.json');
                const tmp = `${dataPath}.tmp`;
                await fs.writeFile(tmp, JSON.stringify(data, null, 2));
                await fs.rename(tmp, dataPath);
                return { success: true, appId };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
    'run-live-note-agent': {
        description: "Manually trigger the live-note agent to run now on a note. Equivalent to the user clicking the Run button in the live-note sidebar, but you can pass extra `context` to bias what the agent does this run — most useful for backfills (e.g. seeding a newly-made-live note from existing synced emails) or focused refreshes. Returns the action taken, summary, and the new note body.",
        inputSchema: z.object({
            filePath: z.string().describe("Workspace-relative path to the note file (e.g., 'knowledge/Notes/my-note.md'). The note must already have a `live:` block in its frontmatter."),
            context: z.string().optional().describe(
                "Optional extra context for the live-note agent to consider for THIS run only — does not modify the note's objective. " +
                "Use it to drive backfills (e.g. 'Backfill from existing synced emails in gmail_sync/ from the last 90 days about this topic') " +
                "or focused refreshes (e.g. 'Focus on changes from the last 7 days'). " +
                "Omit for a plain refresh."
            ),
        }),
        execute: async ({ filePath, context }: { filePath: string; context?: string }) => {
            const knowledgeRelativePath = filePath.replace(/^knowledge\//, '');
            try {
                // Lazy import to break a module-init cycle:
                // builtin-tools → live-note/runner → runs/runs → agents/runtime → builtin-tools
                const { runLiveNoteAgent } = await import("../../knowledge/live-note/runner.js");
                const result = await runLiveNoteAgent(knowledgeRelativePath, 'manual', context);
                return {
                    success: !result.error,
                    runId: result.runId,
                    action: result.action,
                    summary: result.summary,
                    contentAfter: result.contentAfter,
                    error: result.error,
                };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return { success: false, error: msg };
            }
        },
    },

    'create-background-task': {
        description: "Create a new background task on disk. This is the tool you call to materialize a bg-task — do NOT try to write `task.yaml` yourself with file-editText, and do NOT search the codebase for IPC channels like `bg-task:create`. The framework slugifies the name and lays out `bg-tasks/<slug>/{task.yaml,index.md,runs/}`. After this returns, immediately call `run-background-task-agent` with the returned slug so the user sees content right away.",
        inputSchema: CreateBackgroundTaskInput,
        execute: async (input: z.infer<typeof CreateBackgroundTaskInput>) => {
            try {
                let projectId: string | undefined;
                let warning: string | undefined;
                if (input.projectDir) {
                    const r = await resolveCodeProject(input.projectDir);
                    if (!r.ok) return { success: false, error: r.error };
                    projectId = r.projectId;
                    warning = r.warning;
                }
                const { createTask } = await import("../../background-tasks/fileops.js");
                const result = await createTask({
                    name: input.name,
                    instructions: input.instructions,
                    ...(input.triggers ? { triggers: input.triggers } : {}),
                    ...(projectId ? { projectId } : {}),
                    ...(input.model ? { model: input.model } : {}),
                    ...(input.provider ? { provider: input.provider } : {}),
                });
                return { success: true, slug: result.slug, ...(warning ? { warning } : {}) };
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    },

    'patch-background-task': {
        description: "Update an existing background task — instructions, triggers, active, or model/provider. Use this when the user's new ask overlaps with an existing task (extend-don't-fork): rewrite the instructions in full to absorb the new ask rather than creating a duplicate sibling task. Look up existing tasks with `file-glob` on `bg-tasks/*/task.yaml` and `file-readText` on the candidates first.",
        inputSchema: PatchBackgroundTaskInput,
        execute: async (input: z.infer<typeof PatchBackgroundTaskInput>) => {
            try {
                const { patchTask } = await import("../../background-tasks/fileops.js");
                const { slug, projectDir, ...partial } = input;
                let warning: string | undefined;
                if (projectDir) {
                    const r = await resolveCodeProject(projectDir);
                    if (!r.ok) return { success: false, error: r.error };
                    (partial as { projectId?: string }).projectId = r.projectId;
                    warning = r.warning;
                }
                const result = await patchTask(slug, partial);
                return { success: true, task: result, ...(warning ? { warning } : {}) };
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    },

    'run-background-task-agent': {
        description: "Manually trigger a background task to run now. Equivalent to the user clicking the Run button in the Background Task detail view. Pass extra `context` to bias what the agent does this run (e.g. a backfill instruction) — does NOT modify the task's persistent instructions.",
        inputSchema: z.object({
            slug: z.string().describe("The slug of the bg-task to run (e.g., 'morning-weather'). The slug is what `bg-task:create` returns."),
            context: z.string().optional().describe(
                "Optional extra context for THIS run only — does not modify the task's instructions. " +
                "Use it for backfills (e.g. 'Backfill from emails received in the last 7 days') " +
                "or focused refreshes (e.g. 'Focus on changes since yesterday'). " +
                "Omit for a plain run."
            ),
        }),
        execute: async ({ slug, context }: { slug: string; context?: string }) => {
            try {
                // Lazy import to break a module-init cycle, mirroring run-live-note-agent.
                const { runBackgroundTask } = await import("../../background-tasks/runner.js");
                const result = await runBackgroundTask(slug, 'manual', context);
                return {
                    success: !result.error,
                    runId: result.runId,
                    summary: result.summary,
                    error: result.error,
                };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return { success: false, error: msg };
            }
        },
    },

    'launch-code-task': {
        description: "Launch an autonomous coding session that implements a unit of work in the bg-task's pinned code repo. ONLY usable from a coding background task (one with a configured code project). The session runs full-auto in its own isolated git worktree/branch — it never touches the user's checkout — and runs asynchronously: this returns as soon as the session is created, so you can launch several (one per group of related items) in the same run. The tool writes and later updates a row under a `## Code Sessions` section in the task's index.md — do NOT edit that section yourself. Write an excellent, fully self-contained `prompt`: the coding agent has no other context and no human to ask. Group related items into one call; split unrelated items into separate calls.",
        inputSchema: z.object({
            taskSlug: z.string().describe("The slug of THIS background task (it's in your run message, e.g. 'implement-meeting-items'). Used to find the pinned repo and to update index.md."),
            meeting: z.string().min(1).describe("The name/title of the meeting these items came from (e.g. 'Eng Sync — 2026-06-18'). Sessions are grouped under this heading in index.md so the user can see which meeting each change came from."),
            title: z.string().min(1).max(120).describe("Short human title for this unit of work — one line in index.md (e.g. 'Add retry to upload client')."),
            items: z.string().min(1).describe("Brief description of the action item(s) this session implements, for the summary row (e.g. 'Fix flaky upload + add retry; raised in standup')."),
            prompt: z.string().min(1).describe("The full, self-contained coding instruction. Include the concrete goal, relevant context from the meeting, any files/areas to look at, and what 'done' means. The agent runs autonomously with no human — be specific and complete."),
            context: z.string().optional().describe("Optional extra context, e.g. the relevant excerpt from the meeting."),
        }),
        execute: async (input: { taskSlug: string; meeting: string; title: string; items: string; prompt: string; context?: string }, ctx?: ToolContext) => {
            try {
                const { launchCodeTask } = await import("../../background-tasks/code-sessions.js");
                const result = await launchCodeTask({
                    taskSlug: input.taskSlug,
                    meeting: input.meeting,
                    title: input.title,
                    items: input.items,
                    prompt: input.prompt,
                    ...(input.context ? { context: input.context } : {}),
                    ...(ctx?.runId ? { runId: ctx.runId } : {}),
                });
                return result;
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    },

    'notify-user': {
        description: "Show a native OS notification to the user. Clicking the notification opens the provided link in the default browser, or focuses the Rowboat app if no link is given.",
        inputSchema: z.object({
            title: z.string().min(1).max(120).optional().describe("Bold headline shown at the top of the notification. Defaults to 'Rowboat'."),
            message: z.string().min(1).describe("Body text of the notification."),
            link: z.string().url().refine((v) => /^(https?|rowboat):\/\//i.test(v), {
                message: "link must be an http(s):// or rowboat:// URL",
            }).optional().describe("Optional URL opened when the user clicks the notification. Accepts http(s):// (opens in browser) or rowboat:// (opens a view inside Rowboat — see the notify-user skill for deep-link shapes)."),
            actionLabel: z.string().min(1).max(20).optional().describe("Optional label for an inline action button on the notification (e.g. 'Open', 'View', 'Take Notes'). Only shown when `link` is set. Click on the button triggers the same action as clicking the notification body."),
            secondaryActions: z.array(z.object({
                label: z.string().min(1).max(30),
                link: z.string().url().refine((v) => /^(https?|rowboat):\/\//i.test(v), {
                    message: "secondary action link must be an http(s):// or rowboat:// URL",
                }),
            })).max(4).optional().describe("Additional action buttons. macOS shows them in the chevron menu next to the primary button (or all inline in Alert style). Each has its own label and link — clicking the button triggers that link, independent of the primary `link`."),
        }),
        isAvailable: async () => {
            try {
                return container.resolve<INotificationService>('notificationService').isSupported();
            } catch {
                return false;
            }
        },
        execute: async ({ title, message, link, actionLabel, secondaryActions }: { title?: string; message: string; link?: string; actionLabel?: string; secondaryActions?: Array<{ label: string; link: string }> }, ctx?: ToolContext) => {
            try {
                const service = container.resolve<INotificationService>('notificationService');
                if (!service.isSupported()) {
                    return { success: false, error: 'Notifications are not supported on this system' };
                }
                let uc = getCurrentUseCase()?.useCase;
                // ALS doesn't reliably propagate across the run's async generator,
                // so when the in-context use-case is missing, fall back to the
                // persisted use case on the run record via ctx.runId.
                if (!uc && ctx?.runId) {
                    try {
                        const { fetchRun } = await import("../../runs/runs.js");
                        const run = await fetchRun(ctx.runId);
                        uc = run.useCase;
                    } catch {
                        // best effort — fall through to the default branch
                    }
                }
                if (uc === 'background_task_agent') {
                    // User-configured background agent: gate behind the
                    // background_task category (toggleable), suppress the reopen
                    // flood, and default the deep-link to the background tasks
                    // page if the agent didn't supply its own link.
                    await notifyIfEnabled('background_task', {
                        title,
                        message,
                        link: link ?? 'rowboat://open?type=bg-tasks',
                        actionLabel,
                        secondaryActions,
                        suppressDuringStartupGrace: true,
                        onlyWhenBackground: true,
                    });
                } else {
                    // Regular chat (or any other) agent calling notify-user:
                    // notify directly as before.
                    service.notify({ title, message, link, actionLabel, secondaryActions });
                }
                return { success: true };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },
};
