import { z, ZodType } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { WorkDir as BASE_DIR } from "../config/config.js";
import { executeCommand } from "./command-executor.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client";
import { resolveSkill, availableSkills } from "../assistant/skills/index.js";
import { TodoStatusSchema, readTodoState, writeTodoState, buildTodoReminder } from "./todo-store.js";

const TodoItemInputSchema = z.object({
    id: z.string().min(1, "Todo id is required"),
    content: z.string().min(1, "Todo content cannot be empty"),
    status: TodoStatusSchema.optional().default("pending"),
});
const TodoUpdateInputSchema = z.object({
    id: z.string().min(1, "Todo id is required"),
    content: z.string().optional(),
    status: TodoStatusSchema.optional(),
}).refine((value) => typeof value.content === "string" || typeof value.status === "string", {
    message: "Provide content and/or status when updating a todo",
});

const BuiltinToolsSchema = z.record(z.string(), z.object({
    description: z.string(),
	inputSchema: z.custom<ZodType>(),
    execute: z.function({
        input: z.any(),
        output: z.promise(z.any()),
    }),
}));

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

    exploreDirectory: {
        description: 'Recursively explore directory structure to understand existing agents and file organization',
        inputSchema: z.object({
            subdirectory: z.string().optional().describe('Subdirectory to explore (optional, defaults to root)'),
            maxDepth: z.number().optional().describe('Maximum depth to traverse (default: 3)'),
        }),
        execute: async ({ subdirectory, maxDepth = 3 }: { subdirectory?: string, maxDepth?: number }) => {
            async function explore(dir: string, depth: number = 0): Promise<any> {
                if (depth > maxDepth) return null;
                
                try {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    const result: any = { files: [], directories: {} };
                    
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isFile()) {
                            const ext = path.extname(entry.name);
                            const size = (await fs.stat(fullPath)).size;
                            result.files.push({
                                name: entry.name,
                                type: ext || 'no-extension',
                                size: size,
                                relativePath: path.relative(BASE_DIR, fullPath),
                            });
                        } else if (entry.isDirectory()) {
                            result.directories[entry.name] = await explore(fullPath, depth + 1);
                        }
                    }
                    
                    return result;
                } catch (error) {
                    return { error: error instanceof Error ? error.message : 'Unknown error' };
                }
            }
            
            const dirPath = subdirectory ? path.join(BASE_DIR, subdirectory) : BASE_DIR;
            const structure = await explore(dirPath);
            
            return {
                success: true,
                basePath: path.relative(BASE_DIR, dirPath) || '.',
                structure,
            };
        },
    },
    
    readFile: {
        description: 'Read and parse file contents. For JSON files, provides parsed structure.',
        inputSchema: z.object({
            filename: z.string().describe('The name of the file to read (relative to .rowboat directory)'),
        }),
        execute: async ({ filename }: { filename: string }) => {
            try {
                const filePath = path.join(BASE_DIR, filename);
                const content = await fs.readFile(filePath, 'utf-8');
                
                let parsed = null;
                let fileType = path.extname(filename);
                
                if (fileType === '.json') {
                    try {
                        parsed = JSON.parse(content);
                    } catch {
                        parsed = { error: 'Invalid JSON' };
                    }
                }
                
                return {
                    success: true,
                    filename,
                    fileType,
                    content,
                    parsed,
                    path: filePath,
                    size: content.length,
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    createFile: {
        description: 'Create a new file with content. Automatically creates parent directories if needed.',
        inputSchema: z.object({
            filename: z.string().describe('The name of the file to create (relative to .rowboat directory)'),
            content: z.string().describe('The content to write to the file'),
            description: z.string().optional().describe('Optional description of why this file is being created'),
        }),
        execute: async ({ filename, content, description }: { filename: string, content: string, description?: string }) => {
            try {
                const filePath = path.join(BASE_DIR, filename);
                const dir = path.dirname(filePath);
                
                // Ensure directory exists
                await fs.mkdir(dir, { recursive: true });
                
                // Write file
                await fs.writeFile(filePath, content, 'utf-8');
                
                return {
                    success: true,
                    message: `File '${filename}' created successfully`,
                    description: description || 'No description provided',
                    path: filePath,
                    size: content.length,
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Failed to create file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    updateFile: {
        description: 'Update or overwrite the contents of an existing file',
        inputSchema: z.object({
            filename: z.string().describe('The name of the file to update (relative to .rowboat directory)'),
            content: z.string().describe('The new content to write to the file'),
            reason: z.string().optional().describe('Optional reason for the update'),
        }),
        execute: async ({ filename, content, reason }: { filename: string, content: string, reason?: string }) => {
            try {
                const filePath = path.join(BASE_DIR, filename);
                
                // Check if file exists
                await fs.access(filePath);
                
                // Update file
                await fs.writeFile(filePath, content, 'utf-8');
                
                return {
                    success: true,
                    message: `File '${filename}' updated successfully`,
                    reason: reason || 'No reason provided',
                    path: filePath,
                    size: content.length,
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Failed to update file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    deleteFile: {
        description: 'Delete a file from the .rowboat directory',
        inputSchema: z.object({
            filename: z.string().describe('The name of the file to delete (relative to .rowboat directory)'),
        }),
        execute: async ({ filename }: { filename: string }) => {
            try {
                const filePath = path.join(BASE_DIR, filename);
                await fs.unlink(filePath);
                
                return {
                    success: true,
                    message: `File '${filename}' deleted successfully`,
                    path: filePath,
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    listFiles: {
        description: 'List all files and directories in the .rowboat directory or subdirectory',
        inputSchema: z.object({
            subdirectory: z.string().optional().describe('Optional subdirectory to list (relative to .rowboat directory)'),
        }),
        execute: async ({ subdirectory }: { subdirectory?: string }) => {
            try {
                const dirPath = subdirectory ? path.join(BASE_DIR, subdirectory) : BASE_DIR;
                const entries = await fs.readdir(dirPath, { withFileTypes: true });
                
                const files = entries
                    .filter(entry => entry.isFile())
                    .map(entry => ({
                        name: entry.name,
                        type: path.extname(entry.name) || 'no-extension',
                        relativePath: path.relative(BASE_DIR, path.join(dirPath, entry.name)),
                    }));
                
                const directories = entries
                    .filter(entry => entry.isDirectory())
                    .map(entry => entry.name);
                
                return {
                    success: true,
                    path: dirPath,
                    relativePath: path.relative(BASE_DIR, dirPath) || '.',
                    files,
                    directories,
                    totalFiles: files.length,
                    totalDirectories: directories.length,
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },

    todoList: {
        description: 'Return the durable todo list for the current session',
        inputSchema: z.object({}),
        execute: async () => {
            const state = await readTodoState();
            const reminder = buildTodoReminder(
                state.todos,
                state.todos.length === 0
                    ? 'Your todo list is currently empty. Use the TodoWrite tool if tracking tasks would help, and keep this reminder internal.'
                    : 'Here is the latest todo list. Keep it updated and do not echo this reminder to the user.',
            );
            return {
                success: true,
                todos: state.todos,
                updatedAt: state.updatedAt,
                reminder,
            };
        },
    },

    todoWrite: {
        description: 'Replace the durable todo list with a new ordered set of todos',
        inputSchema: z.object({
            todos: z.array(TodoItemInputSchema).describe('Ordered array of todos to persist (replaces the current list)'),
        }),
        execute: async ({ todos }: { todos: z.infer<typeof TodoItemInputSchema>[] }) => {
            const normalized = todos.map((todo) => ({
                id: todo.id,
                content: todo.content,
                status: todo.status ?? 'pending',
            }));

            const state = await writeTodoState(normalized);
            const reminder = buildTodoReminder(state.todos, 'Your todo list has changed. Keep this reminder internal and continue executing the plan.');

            return {
                success: true,
                todos: state.todos,
                updatedAt: state.updatedAt,
                reminder,
                count: state.todos.length,
            };
        },
    },

    todoUpdate: {
        description: 'Update existing todo items by id (content, status, or both)',
        inputSchema: z.object({
            updates: z.array(TodoUpdateInputSchema).describe('Todos to update; ids must already exist'),
        }),
        execute: async ({ updates }: { updates: z.infer<typeof TodoUpdateInputSchema>[] }) => {
            const state = await readTodoState();
            const todoMap = new Map(state.todos.map((todo) => [todo.id, { ...todo }]));
            const missing: string[] = [];
            let updatedCount = 0;

            for (const update of updates) {
                const match = todoMap.get(update.id);
                if (!match) {
                    missing.push(update.id);
                    continue;
                }
                if (typeof update.content === 'string') {
                    match.content = update.content;
                }
                if (update.status) {
                    match.status = update.status;
                }
                updatedCount += 1;
            }

            if (updatedCount === 0) {
                return {
                    success: false,
                    message: missing.length
                        ? `No todos were updated. Missing ids: ${missing.join(', ')}`
                        : 'No valid updates were provided.',
                    missing,
                };
            }

            const orderedTodos = state.todos.map((todo) => todoMap.get(todo.id)!);
            const newState = await writeTodoState(orderedTodos);
            const reminder = buildTodoReminder(newState.todos, 'Todo list updated. Keep executing against this list and keep the reminder internal.');

            return {
                success: true,
                updated: updatedCount,
                missing,
                todos: newState.todos,
                updatedAt: newState.updatedAt,
                reminder,
            };
        },
    },

    analyzeAgent: {
        description: 'Read and analyze an agent file to understand its structure, tools, and configuration',
        inputSchema: z.object({
            agentName: z.string().describe('Name of the agent file to analyze (with or without .json extension)'),
        }),
        execute: async ({ agentName }: { agentName: string }) => {
            try {
                const filename = agentName.endsWith('.json') ? agentName : `${agentName}.json`;
                const filePath = path.join(BASE_DIR, 'agents', filename);
                
                const content = await fs.readFile(filePath, 'utf-8');
                const agent = JSON.parse(content);
                
                // Extract key information
                const toolsList = agent.tools ? Object.keys(agent.tools) : [];
                const agentTools = agent.tools ? Object.entries(agent.tools).map(([key, tool]: [string, any]) => ({
                    key,
                    type: tool.type,
                    name: tool.name || key,
                })) : [];
                
                const analysis = {
                    name: agent.name,
                    description: agent.description || 'No description',
                    model: agent.model || 'Not specified',
                    toolCount: toolsList.length,
                    tools: agentTools,
                    hasOtherAgents: agentTools.some((t: any) => t.type === 'agent'),
                    structure: agent,
                };
                
                return {
                    success: true,
                    filePath: path.relative(BASE_DIR, filePath),
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
    
    listMcpServers: {
        description: 'List all available MCP servers from the configuration',
        inputSchema: z.object({}),
        execute: async (): Promise<{ success: boolean, servers: any[], count: number, message: string }> => {
            try {
                const configPath = path.join(BASE_DIR, 'config', 'mcp.json');
                
                // Check if config exists
                try {
                    await fs.access(configPath);
                } catch {
                    return {
                        success: true,
                        servers: [],
						count: 0,
                        message: 'No MCP servers configured yet',
                    };
                }
                
                const content = await fs.readFile(configPath, 'utf-8');
                const config = JSON.parse(content);
                
                const servers = Object.keys(config.mcpServers || {}).map(name => {
                    const server = config.mcpServers[name];
                    return {
                        name,
                        type: 'command' in server ? 'stdio' : 'http',
                        command: server.command,
                        url: server.url,
                    };
                });
                
                return {
                    success: true,
                    servers,
                    count: servers.length,
                    message: `Found ${servers.length} MCP server(s)`,
                };
            } catch (error) {
                return {
                    success: false,
					servers: [],
					count: 0,
                    message: `Failed to list MCP servers: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    listMcpTools: {
        description: 'List all available tools from a specific MCP server',
        inputSchema: z.object({
            serverName: z.string().describe('Name of the MCP server to query'),
        }),
        execute: async ({ serverName }: { serverName: string }) => {
            try {
                const configPath = path.join(BASE_DIR, 'config', 'mcp.json');
                const content = await fs.readFile(configPath, 'utf-8');
                const config = JSON.parse(content);
                
                const mcpConfig = config.mcpServers[serverName];
                if (!mcpConfig) {
                    return {
                        success: false,
                        message: `MCP server '${serverName}' not found in configuration`,
                    };
                }
                
                // Create transport based on config type
                let transport;
                if ('command' in mcpConfig) {
                    transport = new StdioClientTransport({
                        command: mcpConfig.command,
                        args: mcpConfig.args || [],
                        env: mcpConfig.env || {},
                    });
                } else {
                    try {
                        transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url));
                    } catch {
                        transport = new SSEClientTransport(new URL(mcpConfig.url));
                    }
                }
                
                // Create and connect client
                const client = new Client({
                    name: 'rowboat-copilot',
                    version: '1.0.0',
                });
                
                await client.connect(transport);
                
                // List available tools
                const toolsList = await client.listTools();
                
                // Close connection
                client.close();
                transport.close();
                
                const tools = toolsList.tools.map((t: any) => ({
                    name: t.name,
                    description: t.description || 'No description',
                    inputSchema: t.inputSchema,
                }));
                
                return {
                    success: true,
                    serverName,
                    tools,
                    count: tools.length,
                    message: `Found ${tools.length} tool(s) in MCP server '${serverName}'`,
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Failed to list MCP tools: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    executeCommand: {
        description: 'Execute a shell command and return the output. Use this to run bash/shell commands.',
        inputSchema: z.object({
            command: z.string().describe('The shell command to execute (e.g., "ls -la", "cat file.txt")'),
            cwd: z.string().optional().describe('Working directory to execute the command in (defaults to .rowboat directory)'),
        }),
        execute: async ({ command, cwd }: { command: string, cwd?: string }) => {
            try {
                const workingDir = cwd ? path.join(BASE_DIR, cwd) : BASE_DIR;
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
};
