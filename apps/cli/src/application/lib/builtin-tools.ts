import { z, ZodType } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { WorkDir as BASE_DIR } from "../../config/config.js";
import { executeCommand } from "./command-executor.js";
import { resolveSkill, availableSkills } from "../assistant/skills/index.js";
import { executeTool, listServers, listTools } from "../../mcp/mcp.js";
import container from "../../di/container.js";
import { IMcpConfigRepo } from "../..//mcp/repo.js";
import { McpServerDefinition } from "../../mcp/schema.js";

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
                        validationErrors: validationResult.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`),
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
        execute: async ({ serverName, toolName, arguments: args = {} }: { serverName: string, toolName: string, arguments?: Record<string, any> }) => {
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
