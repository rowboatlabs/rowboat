import { streamText, ModelMessage, tool, stepCountIs } from "ai";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamRenderer } from "../lib/stream-renderer.js";
import { getProvider } from "../lib/models.js";
import { ModelConfig } from "../config/config.js";
import { executeCommand } from "../lib/command-executor.js";

const rl = readline.createInterface({ input, output });

// Base directory for file operations - dynamically use user's home directory
const BASE_DIR = path.join(os.homedir(), ".rowboat");

// Ensure base directory exists
async function ensureBaseDir() {
    try {
        await fs.access(BASE_DIR);
    } catch {
        await fs.mkdir(BASE_DIR, { recursive: true });
        console.log(`📁 Created directory: ${BASE_DIR}\n`);
    }
}

// Export the main copilot function
export async function startCopilot() {
    // Conversation history
    const messages: ModelMessage[] = [];

    console.log("🤖 Rowboat Copilot - Your Intelligent Workflow Assistant");
    console.log(`📂 Working directory: ${BASE_DIR}`);
    console.log("💡 I can help you create, manage, and understand workflows.");
    console.log("Type 'exit' to quit\n");

    // Initialize base directory
    await ensureBaseDir();

    while (true) {
        // Get user input
        const userInput = await rl.question("You: ");
        
        // Exit condition
        if (userInput.toLowerCase() === "exit" || userInput.toLowerCase() === "quit") {
            console.log("\n👋 Goodbye!");
            break;
        }
        
        // Add user message to history
        messages.push({ role: "user", content: userInput });
        
        // Stream AI response
        process.stdout.write("\nCopilot: ");
        
        let currentStep = 0;
        const provider = getProvider();
        const result = streamText({
            model: provider(ModelConfig.defaults.model),
            messages: messages,
            system: `You are an intelligent workflow assistant helping users manage their workflows in ${BASE_DIR}.

WORKFLOW KNOWLEDGE:
- Workflows are JSON files that orchestrate multiple agents
- Agents are JSON files defining AI assistants with specific tools and instructions
- Tools can be built-in functions or MCP (Model Context Protocol) integrations

NOTE: Comments with // in the formats below are for explanation only - do NOT include them in actual JSON files

CORRECT WORKFLOW FORMAT:
{
  "name": "workflow_name",              // REQUIRED - must match filename
  "description": "Description...",       // REQUIRED - must be a description of the workflow
  "steps": [                            // REQUIRED - array of steps
    {
      "type": "agent",                  // REQUIRED - always "agent"
      "id": "agent_name"                // REQUIRED - must match agent filename
    },
    {
      "type": "agent", 
      "id": "another_agent_name"
    }
  ]
}

CORRECT AGENT FORMAT (with detailed tool structure):
{
  "name": "agent_name",                 // REQUIRED - must match filename
  "description": "What agent does",     // REQUIRED - must be a description of the agent
  "model": "gpt-4.1",                   // REQUIRED - model to use
  "instructions": "Instructions...",    // REQUIRED - agent instructions
  "tools": {                            // OPTIONAL - can be empty {} or omitted
    "descriptive_tool_name": {
      "type": "mcp",                    // REQUIRED - always "mcp" for MCP tools
      "name": "actual_mcp_tool_name",   // REQUIRED - exact tool name from MCP server
      "description": "What tool does",  // REQUIRED - clear description
      "mcpServerName": "server_name",   // REQUIRED - name from mcp.json config
      "inputSchema": {                  // REQUIRED - full JSON schema
        "type": "object",
        "properties": {
          "param1": {
            "type": "string",
            "description": "Description of param"  // description is optional but helpful
          }
        },
        "required": ["param1"]          // OPTIONAL - only include if params are required
      }
    }
  }
}

IMPORTANT NOTES:
- Agent tools need: type, name, description, mcpServerName, and inputSchema (all REQUIRED)
- Tool keys in agents should be descriptive (like "search", "fetch", "analyze") not the exact tool name
- Agents can have empty tools {} if they don't need external tools
- The "required" array in inputSchema is OPTIONAL - only include it if the tool has required parameters
- If all parameters are optional, you can omit the "required" field entirely
- Property descriptions in inputSchema are optional but helpful for clarity
- All other fields marked REQUIRED must always be present

EXAMPLE 1 - Firecrawl Search Tool (with required params):
{
  "tools": {
    "search": {
      "type": "mcp",
      "name": "firecrawl_search",
      "description": "Search the web",
      "mcpServerName": "firecrawl",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {"type": "string", "description": "Search query"},
          "limit": {"type": "number", "description": "Number of results"},
          "sources": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "type": {"type": "string", "enum": ["web", "images", "news"]}
              },
              "required": ["type"]
            }
          }
        },
        "required": ["query"]
      }
    }
  }
}

EXAMPLE 2 - ElevenLabs Text-to-Speech (without required array):
{
  "tools": {
    "text_to_speech": {
      "type": "mcp",
      "name": "text_to_speech",
      "description": "Generate audio from text",
      "mcpServerName": "elevenLabs",
      "inputSchema": {
        "type": "object",
        "properties": {
          "text": {"type": "string"}
        }
      }
    }
  }
}

CRITICAL NAMING AND ORGANIZATION RULES:
- Agent filenames MUST match the "name" field in their JSON (e.g., agent_name.json → "name": "agent_name")
- Workflow filenames MUST match the "name" field in their JSON (e.g., workflow_name.json → "name": "workflow_name")
- When referencing agents in workflow steps, the "id" field MUST match the agent's name (e.g., {"type": "agent", "id": "agent_name"})
- All three must be identical: filename, JSON "name" field, and workflow step "id" field
- ALL workflows MUST be placed in the "workflows/" folder (e.g., workflows/workflow_name.json)
- ALL agents MUST be placed in the "agents/" folder (e.g., agents/agent_name.json)
- NEVER create workflows or agents outside these designated folders
- Always maintain this naming and organizational consistency when creating or updating files

YOUR CAPABILITIES:
1. Explore the directory structure to understand existing workflows/agents
2. Create new workflows and agents following best practices
3. Update existing files intelligently
4. Read and analyze file contents to maintain consistency
5. Suggest improvements and ask clarifying questions when needed
6. Execute shell commands to perform system operations
   - Use executeCommand to run bash/shell commands
   - Can list files, check system info, run scripts, etc.
   - Commands execute in the .rowboat directory by default
7. List and explore MCP (Model Context Protocol) servers and their available tools
   - Use listMcpServers to see all configured MCP servers
   - Use listMcpTools to see what tools are available in a specific MCP server
   - This helps users understand what external integrations they can use in their workflows

MCP INTEGRATION:
- MCP servers provide external tools that agents can use (e.g., web scraping, database access, APIs)
- MCP configuration is stored in config/mcp.json
- When users ask about available integrations or tools, check MCP servers
- Help users understand which MCP tools they can add to their agents

DELETION RULES:
- When a user asks to delete a WORKFLOW, you MUST:
  1. First read/analyze the workflow to identify which agents it uses
  2. List those agents to the user
  3. Ask the user if they want to delete those agents as well
  4. Wait for their response before proceeding with any deletions
  5. Only delete what the user confirms
- When a user asks to delete an AGENT, you MUST:
  1. First read/analyze the agent to identify which workflows it is used in
  2. List those workflows to the user
  3. Ask the user if they want to delete/modify those workflows as well
  4. Wait for their response before proceeding with any deletions
  5. Only delete/modify what the user confirms

COMMUNICATION STYLE:
- Break down complex tasks into clear steps
- Explore existing files/structure before creating new ones
- Explain your reasoning as you work through tasks
- Be proactive in understanding context
- Confirm what you've done and suggest next steps
- Always ask for confirmation before destructive operations!!

Always use relative paths (no ${BASE_DIR} prefix) when calling tools.`,
            
            tools: {
                exploreDirectory: tool({
                    description: 'Recursively explore directory structure to understand existing workflows, agents, and file organization',
                    inputSchema: z.object({
                        subdirectory: z.string().optional().describe('Subdirectory to explore (optional, defaults to root)'),
                        maxDepth: z.number().optional().describe('Maximum depth to traverse (default: 3)'),
                    }),
                    execute: async ({ subdirectory, maxDepth = 3 }) => {
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
                }),
                
                readFile: tool({
                    description: 'Read and parse file contents. For JSON files, provides parsed structure.',
                    inputSchema: z.object({
                        filename: z.string().describe('The name of the file to read (relative to .rowboat directory)'),
                    }),
                    execute: async ({ filename }) => {
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
                }),
                
                createFile: tool({
                    description: 'Create a new file with content. Automatically creates parent directories if needed.',
                    inputSchema: z.object({
                        filename: z.string().describe('The name of the file to create (relative to .rowboat directory)'),
                        content: z.string().describe('The content to write to the file'),
                        description: z.string().optional().describe('Optional description of why this file is being created'),
                    }),
                    execute: async ({ filename, content, description }) => {
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
                }),
                
                updateFile: tool({
                    description: 'Update or overwrite the contents of an existing file',
                    inputSchema: z.object({
                        filename: z.string().describe('The name of the file to update (relative to .rowboat directory)'),
                        content: z.string().describe('The new content to write to the file'),
                        reason: z.string().optional().describe('Optional reason for the update'),
                    }),
                    execute: async ({ filename, content, reason }) => {
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
                }),
                
                deleteFile: tool({
                    description: 'Delete a file from the .rowboat directory',
                    inputSchema: z.object({
                        filename: z.string().describe('The name of the file to delete (relative to .rowboat directory)'),
                    }),
                    execute: async ({ filename }) => {
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
                }),
                
                listFiles: tool({
                    description: 'List all files and directories in the .rowboat directory or subdirectory',
                    inputSchema: z.object({
                        subdirectory: z.string().optional().describe('Optional subdirectory to list (relative to .rowboat directory)'),
                    }),
                    execute: async ({ subdirectory }) => {
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
                }),
                
                analyzeWorkflow: tool({
                    description: 'Read and analyze a workflow file to understand its structure, agents, and dependencies',
                    inputSchema: z.object({
                        workflowName: z.string().describe('Name of the workflow file to analyze (with or without .json extension)'),
                    }),
                    execute: async ({ workflowName }) => {
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
                }),
                
                listMcpServers: tool({
                    description: 'List all available MCP servers from the configuration',
                    inputSchema: z.object({}),
                    execute: async () => {
                        try {
                            const configPath = path.join(BASE_DIR, 'config', 'mcp.json');
                            
                            // Check if config exists
                            try {
                                await fs.access(configPath);
                            } catch {
                                return {
                                    success: true,
                                    servers: [],
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
                                message: `Failed to list MCP servers: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            };
                        }
                    },
                }),
                
                listMcpTools: tool({
                    description: 'List all available tools from a specific MCP server',
                    inputSchema: z.object({
                        serverName: z.string().describe('Name of the MCP server to query'),
                    }),
                    execute: async ({ serverName }) => {
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
                }),
                
                executeCommand: tool({
                    description: 'Execute a shell command and return the output. Use this to run bash/shell commands.',
                    inputSchema: z.object({
                        command: z.string().describe('The shell command to execute (e.g., "ls -la", "cat file.txt")'),
                        cwd: z.string().optional().describe('Working directory to execute the command in (defaults to .rowboat directory)'),
                    }),
                    execute: async ({ command, cwd }) => {
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
                }),
            },
            stopWhen: stepCountIs(20),
        });
        
        // Initialize renderer with workflow-style output
        const renderer = new StreamRenderer({
            showHeaders: false,
            dimReasoning: true,
            jsonIndent: 2,
            truncateJsonAt: 500,
        });
        
        // Stream and collect response using fullStream
        let assistantResponse = "";
        const { fullStream } = result;
        
        for await (const event of fullStream) {
            switch (event.type) {
                case "reasoning-start":
                    renderer.render({
                        type: "stream-event",
                        stepId: "copilot",
                        event: { type: "reasoning-start" }
                    });
                    break;
                case "reasoning-delta":
                    renderer.render({
                        type: "stream-event",
                        stepId: "copilot",
                        event: { type: "reasoning-delta", delta: event.text }
                    });
                    break;
                case "reasoning-end":
                    renderer.render({
                        type: "stream-event",
                        stepId: "copilot",
                        event: { type: "reasoning-end" }
                    });
                    break;
                case "text-start":
                    renderer.render({
                        type: "stream-event",
                        stepId: "copilot",
                        event: { type: "text-start" }
                    });
                    break;
                case "text-delta":
                    renderer.render({
                        type: "stream-event",
                        stepId: "copilot",
                        event: { type: "text-delta", delta: event.text }
                    });
                    assistantResponse += event.text;
                    break;
                case "text-end":
                    renderer.render({
                        type: "stream-event",
                        stepId: "copilot",
                        event: { type: "text-end" }
                    });
                    break;
                case "tool-call":
                    renderer.render({
                        type: "stream-event",
                        stepId: "copilot",
                        event: {
                            type: "tool-call",
                            toolCallId: event.toolCallId,
                            toolName: event.toolName,
                            input: 'args' in event ? event.args : event.input
                        }
                    });
                    break;
                case "tool-result":
                    // Tool results are not directly rendered in copilot mode
                    break;
                case "finish":
                    renderer.render({
                        type: "stream-event",
                        stepId: "copilot",
                        event: {
                            type: "usage",
                            usage: event.totalUsage
                        }
                    });
                    break;
            }
        }
        
        console.log();
        
        // Add assistant response to history
        messages.push({ role: "assistant", content: assistantResponse });
        
        // Keep only the last 20 messages (10 user + 10 assistant pairs)
        if (messages.length > 20) {
            messages.splice(0, messages.length - 20);
        }
    }

    rl.close();
}
