import { z, ZodType } from "zod";
import * as path from "path";
import * as fs from "fs/promises";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { execSync } from "child_process";
import { glob } from "glob";
import { executeCommand, executeCommandAbortable } from "./command-executor.js";
import { resolveSkill, availableSkills } from "../assistant/skills/index.js";
import { executeTool, listServers, listTools } from "../../mcp/mcp.js";
import container from "../../di/container.js";
import { IMcpConfigRepo } from "../..//mcp/repo.js";
import { McpServerDefinition } from "@x/shared/dist/mcp.js";
import * as workspace from "../../workspace/workspace.js";
import { IAgentsRepo } from "../../agents/repo.js";
import { WorkDir } from "../../config/config.js";
import { composioAccountsRepo } from "../../composio/repo.js";
import { executeAction as executeComposioAction, isConfigured as isComposioConfigured, searchTools as searchComposioTools } from "../../composio/client.js";
import { CURATED_TOOLKITS, CURATED_TOOLKIT_SLUGS } from "@x/shared/dist/composio.js";
import type { ToolContext } from "./exec-tool.js";
import { generateText } from "ai";
import { createProvider } from "../../models/models.js";
import { IModelConfigRepo } from "../../models/repo.js";
import { isSignedIn } from "../../account/account.js";
import { getGatewayProvider } from "../../models/gateway.js";
import { getAccessToken } from "../../auth/tokens.js";
import { API_URL } from "../../config/env.js";
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

    'workspace-getRoot': {
        description: 'Get the workspace root directory path',
        inputSchema: z.object({}),
        execute: async () => {
            try {
                return await workspace.getRoot();
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-exists': {
        description: 'Check if a file or directory exists in the workspace',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative path to check'),
        }),
        execute: async ({ path: relPath }: { path: string }) => {
            try {
                return await workspace.exists(relPath);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-stat': {
        description: 'Get file or directory statistics (size, modification time, etc.)',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative path to stat'),
        }),
        execute: async ({ path: relPath }: { path: string }) => {
            try {
                return await workspace.stat(relPath);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-readdir': {
        description: 'List directory contents. Can recursively explore directory structure with options.',
        inputSchema: z.object({
            path: z.string().describe('Workspace-relative directory path (empty string for root)'),
            recursive: z.boolean().optional().describe('Recursively list all subdirectories (default: false)'),
            includeStats: z.boolean().optional().describe('Include file stats like size and modification time (default: false)'),
            includeHidden: z.boolean().optional().describe('Include hidden files starting with . (default: false)'),
            allowedExtensions: z.array(z.string()).optional().describe('Filter by file extensions (e.g., [".json", ".ts"])'),
        }),
        execute: async ({ 
            path: relPath, 
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
                const entries = await workspace.readdir(relPath || '', {
                    recursive,
                    includeStats,
                    includeHidden,
                    allowedExtensions,
                });
                return entries;
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-readFile': {
        description: 'Read a file from the workspace. For text files (utf8, the default), returns the content with each line prefixed by its 1-indexed line number (e.g. `12: some text`). Use the `offset` and `limit` parameters to page through large files; defaults read up to 2000 lines starting at line 1. Output is wrapped in `<path>`, `<type>`, `<content>` tags and ends with a footer indicating whether the read reached end-of-file or was truncated. Line numbers in the output are display-only — do NOT include them when later writing or editing the file. For `base64` / `binary` encodings, returns the raw bytes as a string and ignores `offset` / `limit`.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative file path'),
            offset: z.coerce.number().int().min(1).optional().describe('1-indexed line to start reading from (default: 1). Utf8 only.'),
            limit: z.coerce.number().int().min(1).optional().describe('Maximum number of lines to read (default: 2000). Utf8 only.'),
            encoding: z.enum(['utf8', 'base64', 'binary']).optional().describe('File encoding (default: utf8)'),
        }),
        execute: async ({
            path: relPath,
            offset,
            limit,
            encoding = 'utf8',
        }: {
            path: string;
            offset?: number;
            limit?: number;
            encoding?: 'utf8' | 'base64' | 'binary';
        }) => {
            try {
                if (encoding !== 'utf8') {
                    return await workspace.readFile(relPath, encoding);
                }

                const DEFAULT_READ_LIMIT = 2000;
                const MAX_LINE_LENGTH = 2000;
                const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`;
                const MAX_BYTES = 50 * 1024;
                const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`;

                const absPath = workspace.resolveWorkspacePath(relPath);
                const stats = await fs.lstat(absPath);
                const stat = workspace.statToSchema(stats, 'file');
                const etag = workspace.computeEtag(stats.size, stats.mtimeMs);

                const effectiveOffset = offset ?? 1;
                const effectiveLimit = limit ?? DEFAULT_READ_LIMIT;
                const start = effectiveOffset - 1;

                const stream = createReadStream(absPath, { encoding: 'utf8' });
                const rl = createInterface({ input: stream, crlfDelay: Infinity });

                const collected: string[] = [];
                let totalLines = 0;
                let bytes = 0;
                let truncatedByBytes = false;
                let hasMoreLines = false;

                try {
                    for await (const text of rl) {
                        totalLines += 1;
                        if (totalLines <= start) continue;

                        if (collected.length >= effectiveLimit) {
                            hasMoreLines = true;
                            continue;
                        }

                        const line = text.length > MAX_LINE_LENGTH
                            ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX
                            : text;
                        const size = Buffer.byteLength(line, 'utf-8') + (collected.length > 0 ? 1 : 0);
                        if (bytes + size > MAX_BYTES) {
                            truncatedByBytes = true;
                            hasMoreLines = true;
                            break;
                        }

                        collected.push(line);
                        bytes += size;
                    }
                } finally {
                    rl.close();
                    stream.destroy();
                }

                if (totalLines < effectiveOffset && !(totalLines === 0 && effectiveOffset === 1)) {
                    return { error: `Offset ${effectiveOffset} is out of range for this file (${totalLines} lines)` };
                }

                const prefixed = collected.map((line, index) => `${index + effectiveOffset}: ${line}`);
                const lastReadLine = effectiveOffset + collected.length - 1;
                const nextOffset = lastReadLine + 1;

                let footer: string;
                if (truncatedByBytes) {
                    footer = `(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${effectiveOffset}-${lastReadLine}. Use offset=${nextOffset} to continue.)`;
                } else if (hasMoreLines) {
                    footer = `(Showing lines ${effectiveOffset}-${lastReadLine} of ${totalLines}. Use offset=${nextOffset} to continue.)`;
                } else {
                    footer = `(End of file - total ${totalLines} lines)`;
                }

                const content = [
                    `<path>${relPath}</path>`,
                    `<type>file</type>`,
                    `<content>`,
                    prefixed.join('\n'),
                    '',
                    footer,
                    `</content>`,
                ].join('\n');

                return {
                    path: relPath,
                    encoding: 'utf8' as const,
                    content,
                    stat,
                    etag,
                    offset: effectiveOffset,
                    limit: effectiveLimit,
                    totalLines,
                    hasMore: hasMoreLines || truncatedByBytes,
                };
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-writeFile': {
        description: 'Write or update file contents in the workspace. Automatically creates parent directories and supports atomic writes.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative file path'),
            data: z.string().describe('File content to write'),
            encoding: z.enum(['utf8', 'base64', 'binary']).optional().describe('Data encoding (default: utf8)'),
            atomic: z.boolean().optional().describe('Use atomic write (default: true)'),
            mkdirp: z.boolean().optional().describe('Create parent directories if needed (default: true)'),
            expectedEtag: z.string().optional().describe('ETag to check for concurrent modifications (conflict detection)'),
        }),
        execute: async ({
            path: relPath,
            data,
            encoding,
            atomic,
            mkdirp,
            expectedEtag
        }: {
            path: string;
            data: string;
            encoding?: 'utf8' | 'base64' | 'binary';
            atomic?: boolean;
            mkdirp?: boolean;
            expectedEtag?: string;
        }) => {
            try {
                return await workspace.writeFile(relPath, data, {
                    encoding,
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

    'workspace-edit': {
        description: 'Make precise edits to a file by replacing specific text. Safer than rewriting entire files - produces smaller diffs and reduces risk of data loss.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative file path'),
            oldString: z.string().describe('Exact text to find and replace'),
            newString: z.string().describe('Replacement text'),
            replaceAll: z.boolean().optional().describe('Replace all occurrences (default: false, fails if not unique)'),
        }),
        execute: async ({
            path: relPath,
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
                const result = await workspace.readFile(relPath, 'utf8');
                const content = result.data;

                const occurrences = content.split(oldString).length - 1;

                if (occurrences === 0) {
                    return { error: 'oldString not found in file' };
                }

                if (occurrences > 1 && !replaceAll) {
                    return {
                        error: `oldString found ${occurrences} times. Use replaceAll: true or provide more context to make it unique.`
                    };
                }

                const newContent = replaceAll
                    ? content.replaceAll(oldString, newString)
                    : content.replace(oldString, newString);

                await workspace.writeFile(relPath, newContent, { encoding: 'utf8' });

                return {
                    success: true,
                    replacements: replaceAll ? occurrences : 1
                };
            } catch (error) {
                return { error: error instanceof Error ? error.message : 'Unknown error' };
            }
        },
    },

    'workspace-mkdir': {
        description: 'Create a directory in the workspace',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative directory path'),
            recursive: z.boolean().optional().describe('Create parent directories if needed (default: true)'),
        }),
        execute: async ({ path: relPath, recursive = true }: { path: string; recursive?: boolean }) => {
            try {
                return await workspace.mkdir(relPath, recursive);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-rename': {
        description: 'Rename or move a file or directory in the workspace',
        inputSchema: z.object({
            from: z.string().min(1).describe('Source workspace-relative path'),
            to: z.string().min(1).describe('Destination workspace-relative path'),
            overwrite: z.boolean().optional().describe('Overwrite destination if it exists (default: false)'),
        }),
        execute: async ({ from, to, overwrite = false }: { from: string; to: string; overwrite?: boolean }) => {
            try {
                return await workspace.rename(from, to, overwrite);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-copy': {
        description: 'Copy a file in the workspace (directories not supported)',
        inputSchema: z.object({
            from: z.string().min(1).describe('Source workspace-relative file path'),
            to: z.string().min(1).describe('Destination workspace-relative file path'),
            overwrite: z.boolean().optional().describe('Overwrite destination if it exists (default: false)'),
        }),
        execute: async ({ from, to, overwrite = false }: { from: string; to: string; overwrite?: boolean }) => {
            try {
                return await workspace.copy(from, to, overwrite);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-remove': {
        description: 'Remove a file or directory from the workspace. Files are moved to trash by default for safety.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative path to remove'),
            recursive: z.boolean().optional().describe('Required for directories (default: false)'),
            trash: z.boolean().optional().describe('Move to trash instead of permanent delete (default: true)'),
        }),
        execute: async ({ path: relPath, recursive, trash }: { path: string; recursive?: boolean; trash?: boolean }) => {
            try {
                return await workspace.remove(relPath, {
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

    'workspace-glob': {
        description: 'Find files matching a glob pattern (e.g., "**/*.ts", "src/**/*.json"). Much faster than recursive readdir for finding files.',
        inputSchema: z.object({
            pattern: z.string().describe('Glob pattern to match files'),
            cwd: z.string().optional().describe('Subdirectory to search in, relative to workspace root (default: workspace root)'),
        }),
        execute: async ({ pattern, cwd }: { pattern: string; cwd?: string }) => {
            try {
                const searchDir = cwd ? path.join(WorkDir, cwd) : WorkDir;

                // Ensure search directory is within workspace
                const resolvedSearchDir = path.resolve(searchDir);
                if (!resolvedSearchDir.startsWith(WorkDir)) {
                    return { error: 'Search directory must be within workspace' };
                }

                const files = await glob(pattern, {
                    cwd: searchDir,
                    nodir: true,
                    ignore: ['node_modules/**', '.git/**'],
                });

                return {
                    files,
                    count: files.length,
                    pattern,
                    cwd: cwd || '.',
                };
            } catch (error) {
                return { error: error instanceof Error ? error.message : 'Unknown error' };
            }
        },
    },

    'workspace-grep': {
        description: 'Search file contents using regex. Returns matching files and lines. Uses ripgrep if available, falls back to grep.',
        inputSchema: z.object({
            pattern: z.string().describe('Regex pattern to search for'),
            searchPath: z.string().optional().describe('Directory or file to search, relative to workspace root (default: workspace root)'),
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
                const targetPath = searchPath ? path.join(WorkDir, searchPath) : WorkDir;

                // Ensure target path is within workspace
                const resolvedTargetPath = path.resolve(targetPath);
                if (!resolvedTargetPath.startsWith(WorkDir)) {
                    return { error: 'Search path must be within workspace' };
                }

                // Try ripgrep first
                try {
                    const rgArgs = [
                        '--json',
                        '-e', JSON.stringify(pattern),
                        contextLines > 0 ? `-C ${contextLines}` : '',
                        fileGlob ? `--glob ${JSON.stringify(fileGlob)}` : '',
                        `--max-count ${maxResults}`,
                        '--ignore-case',
                        JSON.stringify(resolvedTargetPath),
                    ].filter(Boolean).join(' ');

                    const output = execSync(`rg ${rgArgs}`, {
                        encoding: 'utf8',
                        maxBuffer: 10 * 1024 * 1024,
                        cwd: WorkDir,
                    });

                    const matches = output.trim().split('\n')
                        .filter(Boolean)
                        .map(line => {
                            try {
                                return JSON.parse(line);
                            } catch {
                                return null;
                            }
                        })
                        .filter(m => m && m.type === 'match');

                    return {
                        matches: matches.map(m => ({
                            file: path.relative(WorkDir, m.data.path.text),
                            line: m.data.line_number,
                            content: m.data.lines.text.trim(),
                        })),
                        count: matches.length,
                        tool: 'ripgrep',
                    };
                } catch (rgError) {
                    // Fallback to basic grep if ripgrep not available or failed
                    const grepArgs = [
                        '-rn',
                        fileGlob ? `--include=${JSON.stringify(fileGlob)}` : '',
                        JSON.stringify(pattern),
                        JSON.stringify(resolvedTargetPath),
                        `| head -${maxResults}`,
                    ].filter(Boolean).join(' ');

                    try {
                        const output = execSync(`grep ${grepArgs}`, {
                            encoding: 'utf8',
                            maxBuffer: 10 * 1024 * 1024,
                            shell: '/bin/sh',
                        });

                        const lines = output.trim().split('\n').filter(Boolean);
                        return {
                            matches: lines.map(line => {
                                const match = line.match(/^(.+?):(\d+):(.*)$/);
                                if (match) {
                                    return {
                                        file: path.relative(WorkDir, match[1]),
                                        line: parseInt(match[2], 10),
                                        content: match[3].trim(),
                                    };
                                }
                                return { file: '', line: 0, content: line };
                            }),
                            count: lines.length,
                            tool: 'grep',
                        };
                    } catch {
                        // No matches found (grep returns non-zero on no matches)
                        return { matches: [], count: 0, tool: 'grep' };
                    }
                }
            } catch (error) {
                return { error: error instanceof Error ? error.message : 'Unknown error' };
            }
        },
    },

    'parseFile': {
        description: 'Parse and extract text content from files (PDF, Excel, CSV, Word .docx). Auto-detects format from file extension.',
        inputSchema: z.object({
            path: z.string().min(1).describe('File path to parse. Can be an absolute path or a workspace-relative path.'),
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

                // Read file as buffer — support both absolute and workspace-relative paths
                let buffer: Buffer;
                if (path.isAbsolute(filePath)) {
                    buffer = await fs.readFile(filePath);
                } else {
                    const result = await workspace.readFile(filePath, 'base64');
                    buffer = Buffer.from(result.data, 'base64');
                }

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
            path: z.string().min(1).describe('File path to parse. Can be an absolute path or a workspace-relative path.'),
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

                // Read file as buffer — support both absolute and workspace-relative paths
                let buffer: Buffer;
                if (path.isAbsolute(filePath)) {
                    buffer = await fs.readFile(filePath);
                } else {
                    const result = await workspace.readFile(filePath, 'base64');
                    buffer = Buffer.from(result.data, 'base64');
                }

                const base64 = buffer.toString('base64');

                // Resolve model config from DI container
                const modelConfigRepo = container.resolve<IModelConfigRepo>('modelConfigRepo');
                const modelConfig = await modelConfigRepo.getConfig();
                const provider = await isSignedIn()
                    ? await getGatewayProvider()
                    : createProvider(modelConfig.provider);
                const model = provider.languageModel(modelConfig.model);

                const userPrompt = prompt || 'Convert this file to well-structured markdown.';

                const response = await generateText({
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
                        signal: ctx.signal,
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
                const result = await executeCommand(command, { cwd: workingDir });

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
                        const result = await workspace.exists(filePath);
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
                        const entries = await workspace.readdir("knowledge", { recursive: true, allowedExtensions: [".md"] });
                        const files = entries.filter(e => e.kind === 'file');
                        const properties = new Map<string, Set<string>>();
                        let noteCount = 0;

                        for (const file of files) {
                            try {
                                const { data } = await workspace.readFile(file.path);
                                const { fields } = parseFrontmatter(data);
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
                        await workspace.writeFile(basePath, JSON.stringify(config, null, 2), { mkdirp: true });
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
};
