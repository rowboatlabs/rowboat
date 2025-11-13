import { streamText, ModelMessage, tool, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const model = openai("gpt-4.1");
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
        const result = streamText({
            model: model,
            messages: messages,
            system: `You are an intelligent workflow assistant helping users manage their workflows in ${BASE_DIR}.

REASONING & THINKING:
- Before taking action, think through what the user is asking for and put out a text with your reasoning process and the steps you will take to complete the task.
- Break down complex tasks into clear steps
- Explore existing files/structure before creating new ones
- Explain your reasoning as you work through tasks
- Be proactive in understanding context

WORKFLOW KNOWLEDGE:
- Workflows are JSON files that orchestrate multiple agents
- Agents are JSON files defining AI assistants with specific tools and instructions
- Tools can be built-in functions or MCP (Model Context Protocol) integrations
- Common structure for workflows: { "name": "workflow_name", "description": "...", "steps": [{"type": "agent", "id": "agent_id"}, ...] }
- Common structure for agents: { "name": "agent_name", "description": "...", "model": "gpt-4o", "instructions": "...", "tools": {...} }

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
- Start by thinking through the request
- Explain what you're exploring and why
- Show your reasoning process
- Confirm what you've done and suggest next steps
- Be conversational but informative
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
            },
            
            stopWhen: stepCountIs(15),
            
            onStepFinish: async ({ toolResults }) => {
                currentStep++;
                
                // Show results with clear formatting
                if (toolResults && toolResults.length > 0) {
                    console.log(`\n[Step ${currentStep}]`);
                    for (const result of toolResults) {
                        const res = result as any;
                        console.log(`🔧 Tool: ${res.toolName}`);
                        
                        if (res.result && typeof res.result === 'object') {
                            const resultData = res.result as any;
                            if (resultData.success) {
                                console.log(`✅ ${resultData.message || 'Success'}`);
                                if (resultData.description) console.log(`   → ${resultData.description}`);
                                if (resultData.reason) console.log(`   → ${resultData.reason}`);
                            } else {
                                console.log(`❌ ${resultData.message || 'Failed'}`);
                            }
                        }
                    }
                    console.log();
                }
            },
        });
        
        // Stream and collect response
        let assistantResponse = "";
        for await (const textPart of result.textStream) {
            process.stdout.write(textPart);
            assistantResponse += textPart;
        }
        console.log("\n");
        
        // Add assistant response to history
        messages.push({ role: "assistant", content: assistantResponse });
        
        // Keep only the last 20 messages (10 user + 10 assistant pairs)
        if (messages.length > 20) {
            messages.splice(0, messages.length - 20);
        }
    }

    rl.close();
}
