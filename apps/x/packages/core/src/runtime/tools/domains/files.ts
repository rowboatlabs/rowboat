// Builtin tools: files domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import * as files from "../../../filesystem/files.js";
import { WorkDir } from "../../../config/config.js";
import { BuiltinToolsSchema } from "../types.js";


export const fileTools: z.infer<typeof BuiltinToolsSchema> = {
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
};
