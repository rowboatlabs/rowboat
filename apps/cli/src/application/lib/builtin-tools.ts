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
        description: 'Recursively explore directory structure to understand existing workflows, agents, and file organization',
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
    
    analyzeWorkflow: {
        description: 'Read and analyze a workflow file to understand its structure, agents, and dependencies',
        inputSchema: z.object({
            workflowName: z.string().describe('Name of the workflow file to analyze (with or without .json extension)'),
        }),
        execute: async ({ workflowName }: { workflowName: string }) => {
            try {
                const filename = workflowName.endsWith('.json') ? workflowName : `${workflowName}.json`;
                const filePath = path.join(BASE_DIR, 'workflows', filename);
                
                const content = await fs.readFile(filePath, 'utf-8');
                const workflow = JSON.parse(content);
                
                // Extract key information
                const analysis = {
                    name: workflow.name,
                    description: workflow.description || 'No description',
                    agentCount: workflow.agents ? workflow.agents.length : 0,
                    agents: workflow.agents || [],
                    tools: workflow.tools || {},
                    structure: workflow,
                };
                
                return {
                    success: true,
                    filePath: path.relative(BASE_DIR, filePath),
                    analysis,
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Failed to analyze workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
