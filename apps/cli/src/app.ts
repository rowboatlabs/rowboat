import { AgentState, streamAgent } from "./agents/runtime.js";
import { StreamRenderer } from "./application/lib/stream-renderer.js";
import { stdin as input, stdout as output } from "node:process";
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import { WorkDir } from "./config/config.js";
import { RunEvent } from "./entities/run-events.js";
import { createInterface, Interface } from "node:readline/promises";
import { ToolCallPart } from "./entities/message.js";
import { Agent } from "./agents/agents.js";
import { McpServerConfig, McpServerDefinition } from "./mcp/schema.js";
import { Example } from "./entities/example.js";
import { z } from "zod";
import { Flavor } from "./models/models.js";
import { examples } from "./examples/index.js";
import container from "./di/container.js";
import { IModelConfigRepo } from "./models/repo.js";

function renderGreeting() {
    const logo = `
                                                                                   
                                  $$\\                            $$\\               
                                  $$ |                           $$ |              
 $$$$$$\\   $$$$$$\\  $$\\  $$\\  $$\\ $$$$$$$\\   $$$$$$\\   $$$$$$\\ $$$$$$\\   $$\\   $$\\ 
$$  __$$\\ $$  __$$\\ $$ | $$ | $$ |$$  __$$\\ $$  __$$\\  \\____$$\\_$$  _|  \\$$\\ $$  |
$$ |  \\__|$$ /  $$ |$$ | $$ | $$ |$$ |  $$ |$$ /  $$ | $$$$$$$ | $$ |     \\$$$$  / 
$$ |      $$ |  $$ |$$ | $$ | $$ |$$ |  $$ |$$ |  $$ |$$  __$$ | $$ |$$\\  $$  $$<  
$$ |      \\$$$$$$  |\\$$$$$\\$$$$  |$$$$$$$  |\\$$$$$$  |\\$$$$$$$ | \\$$$$  |$$  /\\$$\\ 
\\__|       \\______/  \\_____\\____/ \\_______/  \\______/  \\_______|  \\____/ \\__/  \\__|
                                                                                   
                                                                                   
`;
    console.log(logo);
    console.log("\nHow can i help you today?");
}

export async function app(opts: {
    agent: string;
    runId?: string;
    input?: string;
    noInteractive?: boolean;
}) {
    throw new Error("Not implemented");
    /*
    const renderer = new StreamRenderer();
    const state = new AgentState(opts.agent, opts.runId);

    if (opts.agent === "copilot" && !opts.runId) {
        renderGreeting();
    }

    // load existing and assemble state if required
    let runId = opts.runId;
    if (runId) {
        console.error("loading run", runId);
        let stream: fs.ReadStream | null = null;
        let rl: Interface | null = null;
        try {
            const logFile = path.join(WorkDir, "runs", `${runId}.jsonl`);
            stream = fs.createReadStream(logFile, { encoding: "utf8" });
            rl = createInterface({ input: stream, crlfDelay: Infinity });
            for await (const line of rl) {
                if (line.trim() === "") {
                    continue;
                }
                const parsed = JSON.parse(line);
                const event = RunEvent.parse(parsed);
                state.ingest(event);
            }
        } finally {
            stream?.close();
        }
    }

    let rl: Interface | null = null;
    if (!opts.noInteractive) {
        rl = createInterface({ input, output });
    }
    let inputConsumed = false;

    try {
        while (true) {
            // ask for pending tool permissions
            for (const perm of Object.values(state.getPendingPermissions())) {
                if (opts.noInteractive) {
                    return;
                }
                const response = await getToolCallPermission(perm.toolCall, rl!);
                state.ingestAndLog({
                    type: "tool-permission-response",
                    response,
                    toolCallId: perm.toolCall.toolCallId,
                    subflow: perm.subflow,
                });
            }

            // ask for pending human input
            for (const ask of Object.values(state.getPendingAskHumans())) {
                if (opts.noInteractive) {
                    return;
                }
                const response = await getAskHumanResponse(ask.query, rl!);
                state.ingestAndLog({
                    type: "ask-human-response",
                    response,
                    toolCallId: ask.toolCallId,
                    subflow: ask.subflow,
                });
            }

            // run one turn
            for await (const event of streamAgent(state)) {
                renderer.render(event);
                if (event?.type === "error") {
                    process.exitCode = 1;
                }
            }

            // if nothing pending, get user input
            if (state.getPendingPermissions().length === 0 && state.getPendingAskHumans().length === 0) {
                if (opts.input && !inputConsumed) {
                    state.ingestAndLog({
                        type: "message",
                        message: {
                            role: "user",
                            content: opts.input,
                        },
                        subflow: [],
                    });
                    inputConsumed = true;
                    continue;
                }
                if (opts.noInteractive) {
                    return;
                }
                const response = await getUserInput(rl!);
                state.ingestAndLog({
                    type: "message",
                    message: {
                        role: "user",
                        content: response,
                    },
                    subflow: [],
                });
            }
        }
    } finally {
        rl?.close();
    }
    */
}

async function getToolCallPermission(
    call: z.infer<typeof ToolCallPart>,
    rl: Interface,
): Promise<"approve" | "deny"> {
    const question = `Do you want to allow running the following tool: ${call.toolName}?:
    
    Tool name: ${call.toolName}
    Tool arguments: ${JSON.stringify(call.arguments)}

    Choices: y/n/a/d:
    - y: approve
    - n: deny
    `;
    const input = await rl.question(question);
    if (input.toLowerCase() === "y") return "approve";
    if (input.toLowerCase() === "n") return "deny";
    return "deny";
}

async function getAskHumanResponse(
    query: string,
    rl: Interface,
): Promise<string> {
    const input = await rl.question(`The agent is asking for your help with the following query:
    
    Question: ${query}

    Please respond to the question.
    `);
    return input;
}

async function getUserInput(
    rl: Interface,
): Promise<string> {
    const input = await rl.question("You: ");
    if (["quit", "exit", "q"].includes(input.toLowerCase().trim())) {
        console.error("Bye!");
        process.exit(0);
    }
    return input;
}

export async function modelConfig() {
    // load existing model config
    const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
    const config = await repo.getConfig();

    const rl = createInterface({ input, output });
    try {
        const defaultApiKeyEnvVars: Record<z.infer<typeof Flavor>, string> = {
            "rowboat [free]": "",
            openai: "OPENAI_API_KEY",
            aigateway: "AI_GATEWAY_API_KEY",
            anthropic: "ANTHROPIC_API_KEY",
            google: "GOOGLE_GENERATIVE_AI_API_KEY",
            ollama: "",
            "openai-compatible": "",
            openrouter: "",
        };
        const defaultBaseUrls: Record<z.infer<typeof Flavor>, string> = {
            "rowboat [free]": "",
            openai: "https://api.openai.com/v1",
            aigateway: "https://ai-gateway.vercel.sh/v1/ai",
            anthropic: "https://api.anthropic.com/v1",
            google: "https://generativelanguage.googleapis.com/v1beta",
            ollama: "http://localhost:11434",
            "openai-compatible": "http://localhost:8080/v1",
            openrouter: "https://openrouter.ai/api/v1",
        };
        const defaultModels: Record<z.infer<typeof Flavor>, string> = {
            "rowboat [free]": "google/gemini-3-pro-preview",
            openai: "gpt-5.1",
            aigateway: "gpt-5.1",
            anthropic: "claude-sonnet-4-5",
            google: "gemini-2.5-pro",
            ollama: "llama3.1",
            "openai-compatible": "openai/gpt-5.1",
            openrouter: "openrouter/auto",
        };

        const currentProvider = config?.defaults?.provider;
        const currentModel = config?.defaults?.model;
        const currentProviderConfig = currentProvider ? config?.providers?.[currentProvider] : undefined;
        if (config) {
            renderCurrentModel(currentProvider || "none", currentProviderConfig?.flavor || "", currentModel || "none");
        }

        const FlavorList = [...Flavor.options];
        const flavorPromptLines = FlavorList
            .map((f, idx) => `  ${idx + 1}. ${f}`)
            .join("\n");
        const flavorAnswer = await rl.question(
            `Select a provider type:\n${flavorPromptLines}\nEnter number or name: `
        );
        let selectedFlavorRaw = flavorAnswer.trim();
        let selectedFlavor: z.infer<typeof Flavor> | null = null;
        if (/^\d+$/.test(selectedFlavorRaw)) {
            const idx = parseInt(selectedFlavorRaw, 10) - 1;
            if (idx >= 0 && idx < FlavorList.length) {
                selectedFlavor = FlavorList[idx];
            }
        } else if (FlavorList.includes(selectedFlavorRaw as z.infer<typeof Flavor>)) {
            selectedFlavor = selectedFlavorRaw as z.infer<typeof Flavor>;
        }
        if (!selectedFlavor) {
            console.error("Invalid selection. Exiting.");
            return;
        }

        const existingAliases = Object.keys(config?.providers || {}).filter(
            (name) => config?.providers?.[name]?.flavor === selectedFlavor,
        );
        let providerName: string | null = null;
        let chooseMode: "existing" | "add" = "add";
        if (existingAliases.length > 0) {
            const listLines = existingAliases
                .map((alias, idx) => `  ${idx + 1}. use existing: ${alias}`)
                .join("\n");
            const addIndex = existingAliases.length + 1;
            const providerSelect = await rl.question(
                `Found existing providers for ${selectedFlavor}:\n${listLines}\n  ${addIndex}. add new\nEnter number or name/alias [${addIndex}]: `,
            );
            const sel = providerSelect.trim();
            if (sel === "" || sel.toLowerCase() === "add" || sel.toLowerCase() === "new") {
                chooseMode = "add";
            } else if (/^\d+$/.test(sel)) {
                const idx = parseInt(sel, 10) - 1;
                if (idx >= 0 && idx < existingAliases.length) {
                    providerName = existingAliases[idx];
                    chooseMode = "existing";
                } else if (idx === existingAliases.length) {
                    chooseMode = "add";
                } else {
                    console.error("Invalid selection. Exiting.");
                    return;
                }
            } else if (existingAliases.includes(sel)) {
                providerName = sel;
                chooseMode = "existing";
            } else {
                console.error("Invalid selection. Exiting.");
                return;
            }
        }
        if (chooseMode === "existing" && !providerName) {
            console.error("No provider selected. Exiting.");
            return;
        }

        if (chooseMode === "existing") {
            const modelDefault =
                currentProvider === providerName && currentModel
                    ? currentModel
                    : defaultModels[selectedFlavor];
            const modelAns = await rl.question(
                `Specify model for ${selectedFlavor} [${modelDefault}]: `,
            );
            const model = modelAns.trim() || modelDefault;

            await repo.setDefault(providerName!, model);
            console.log(`Model configuration updated. Provider set to '${providerName}'.`);
            return;
        }

        const headers: Record<string, string> = {};

        if (selectedFlavor !== "rowboat [free]") {
            const providerNameAns = await rl.question(
                `Enter a name/alias for this provider [${selectedFlavor}]: `,
            );
            providerName = providerNameAns.trim() || selectedFlavor;
        } else {
            providerName = selectedFlavor;
        }

        let baseURL: string | undefined = undefined;
        if (selectedFlavor !== "rowboat [free]") {
            const baseUrlAns = await rl.question(
                `Enter baseURL for ${selectedFlavor} [${defaultBaseUrls[selectedFlavor]}]: `,
            );
            baseURL = baseUrlAns.trim() || undefined;
        }

        let apiKey: string | undefined = undefined;
        if (selectedFlavor !== "ollama" && selectedFlavor !== "rowboat [free]") {
            let autopickText = "";
            if (defaultApiKeyEnvVars[selectedFlavor]) {
                autopickText = ` (leave blank to pick from environment variable ${defaultApiKeyEnvVars[selectedFlavor]})`;
            }
            const apiKeyAns = await rl.question(
                `Enter API key for ${selectedFlavor}${autopickText}: `,
            );
            apiKey = apiKeyAns.trim() || undefined;
        }
        if (selectedFlavor === "ollama") {
            const keyAns = await rl.question(
                `Enter API key for ${selectedFlavor} (optional): `
            );
            const key = keyAns.trim();
            if (key) {
                headers["Authorization"] = `Bearer ${key}`;
            }
        }

        const modelDefault = defaultModels[selectedFlavor];
        const modelAns = await rl.question(
            `Specify model for ${selectedFlavor} [${modelDefault}]: `,
        );
        const model = modelAns.trim() || modelDefault;

        await repo.upsert(providerName, {
            flavor: selectedFlavor,
            apiKey,
            baseURL,
            headers,
        });
        await repo.setDefault(providerName, model);
        renderCurrentModel(providerName, selectedFlavor, model);
        console.log(`Configuration written to ${WorkDir}/config/models.json. You can also edit this file manually`);
    } finally {
        rl.close();
    }
}

function renderCurrentModel(provider: string, flavor: string, model: string) {
    console.log("Currently using:");
    console.log(`- provider: ${provider}${flavor ? ` (${flavor})` : ""}`);
    console.log(`- model: ${model}`);
    console.log("");
}

async function listAvailableExamples(): Promise<string[]> {
    return Object.keys(examples);
}

async function writeAgents(agents: z.infer<typeof Agent>[] | undefined) {
    if (!agents) {
        return;
    }
    await fsp.mkdir(path.join(WorkDir, "agents"), { recursive: true });
    await Promise.all(
        agents.map(async (agent) => {
            const agentPath = path.join(WorkDir, "agents", `${agent.name}.json`);
            await fsp.writeFile(agentPath, JSON.stringify(agent, null, 2), "utf8");
        }),
    );
}

async function mergeMcpServers(servers: Record<string, z.infer<typeof McpServerDefinition>>) {
    const result = { added: [] as string[], skipped: [] as string[] };
    
    // Early return if no servers to process
    if (!servers || Object.keys(servers).length === 0) {
        return result;
    }
    
    const configPath = path.join(WorkDir, "config", "mcp.json");
    
    // Read existing config
    let currentConfig: z.infer<typeof McpServerConfig> = { mcpServers: {} };
    try {
        const contents = await fsp.readFile(configPath, "utf8");
        currentConfig = McpServerConfig.parse(JSON.parse(contents));
    } catch (error: any) {
        if (error?.code !== "ENOENT") {
            throw new Error(`Unable to read MCP config: ${error.message ?? error}`);
        }
        // File doesn't exist yet, use empty config
    }
    
    // Merge servers
    for (const [name, definition] of Object.entries(servers)) {
        if (currentConfig.mcpServers[name]) {
            result.skipped.push(name);
        } else {
            currentConfig.mcpServers[name] = definition;
            result.added.push(name);
        }
    }
    
    // Only write if we added new servers
    if (result.added.length > 0) {
        await fsp.mkdir(path.dirname(configPath), { recursive: true });
        await fsp.writeFile(configPath, JSON.stringify(currentConfig, null, 2), "utf8");
    }
    
    return result;
}

export async function importExample(exampleName?: string, filePath?: string) {
    let example: z.infer<typeof Example>;
    let sourceName: string;
    
    if (exampleName) {
        // Load from built-in examples
        example = examples[exampleName];
        if (!example) {
            const availableExamples = Object.keys(examples);
            const listMessage = availableExamples.length
                ? `Available examples: ${availableExamples.join(", ")}`
                : "No packaged examples are available.";
            throw new Error(`Unknown example '${exampleName}'. ${listMessage}`);
        }
        sourceName = exampleName;
    } else if (filePath) {
        // Load from file path
        try {
            const fileContent = await fsp.readFile(filePath, "utf8");
            example = Example.parse(JSON.parse(fileContent));
            sourceName = path.basename(filePath, ".json");
        } catch (error: any) {
            if (error?.code === "ENOENT") {
                throw new Error(`File not found: ${filePath}`);
            } else if (error?.name === "ZodError") {
                throw new Error(`Invalid workflow file format: ${error.message}`);
            }
            throw new Error(`Failed to read workflow file: ${error.message ?? error}`);
        }
    } else {
        throw new Error("Either exampleName or filePath must be provided");
    }
    
    // Import agents and MCP servers
    await writeAgents(example.agents);
    let serverMerge = { added: [] as string[], skipped: [] as string[] };
    if (example.mcpServers) {
        serverMerge = await mergeMcpServers(example.mcpServers);
    }
    
    // Build and display output message
    const importedAgents = example.agents?.map((agent) => agent.name) ?? [];
    const entryAgent = example.entryAgent ?? importedAgents[0] ?? "";
    
    const output = [
        `✓ Imported workflow '${sourceName}'`,
        `  Agents: ${importedAgents.join(", ")}`,
        `  Primary: ${entryAgent}`,
    ];
    
    if (serverMerge.added.length > 0) {
        output.push(`  MCP servers added: ${serverMerge.added.join(", ")}`);
    }
    if (serverMerge.skipped.length > 0) {
        output.push(`  MCP servers skipped (already configured): ${serverMerge.skipped.join(", ")}`);
    }
    
    console.log(output.join("\n"));
    
    // Display post-install instructions if present
    if (example.instructions) {
        console.log("\n" + "=".repeat(60));
        console.log("POST-INSTALL INSTRUCTIONS");
        console.log("=".repeat(60));
        console.log(example.instructions);
        console.log("=".repeat(60) + "\n");
    }
    
    // Display next steps
    console.log(`\nRun: rowboatx --agent ${entryAgent}`);
}

export async function listExamples() {
    return listAvailableExamples();
}

export async function exportWorkflow(entryAgentName: string) {
    const agentsDir = path.join(WorkDir, "agents");
    const mcpConfigPath = path.join(WorkDir, "config", "mcp.json");
    
    // Read MCP config
    let mcpConfig: z.infer<typeof McpServerConfig> = { mcpServers: {} };
    try {
        const mcpContent = await fsp.readFile(mcpConfigPath, "utf8");
        mcpConfig = McpServerConfig.parse(JSON.parse(mcpContent));
    } catch (error: any) {
        if (error?.code !== "ENOENT") {
            throw new Error(`Failed to read MCP config: ${error.message ?? error}`);
        }
    }
    
    // Recursively discover all agents and MCP servers
    const discoveredAgents = new Map<string, z.infer<typeof Agent>>();
    const discoveredMcpServers = new Set<string>();
    
    async function discoverAgent(agentName: string) {
        if (discoveredAgents.has(agentName)) {
            return; // Already processed
        }
        
        // Load agent
        const agentPath = path.join(agentsDir, `${agentName}.json`);
        let agentContent: string;
        try {
            agentContent = await fsp.readFile(agentPath, "utf8");
        } catch (error: any) {
            if (error?.code === "ENOENT") {
                throw new Error(`Agent not found: ${agentName}`);
            }
            throw new Error(`Failed to read agent ${agentName}: ${error.message ?? error}`);
        }
        
        const agent = Agent.parse(JSON.parse(agentContent));
        discoveredAgents.set(agentName, agent);
        
        // Process tools
        if (agent.tools) {
            for (const [toolKey, tool] of Object.entries(agent.tools)) {
                if (tool.type === "agent") {
                    // Recursively discover dependent agent
                    await discoverAgent(tool.name);
                } else if (tool.type === "mcp") {
                    // Track MCP server
                    discoveredMcpServers.add(tool.mcpServerName);
                }
            }
        }
    }
    
    // Start discovery from entry agent
    await discoverAgent(entryAgentName);
    
    // Build MCP servers object
    const workflowMcpServers: Record<string, z.infer<typeof McpServerDefinition>> = {};
    for (const serverName of discoveredMcpServers) {
        if (mcpConfig.mcpServers[serverName]) {
            workflowMcpServers[serverName] = mcpConfig.mcpServers[serverName];
        } else {
            throw new Error(`MCP server '${serverName}' is referenced but not found in config`);
        }
    }
    
    // Build workflow object
    const workflow: z.infer<typeof Example> = {
        id: entryAgentName,
        entryAgent: entryAgentName,
        agents: Array.from(discoveredAgents.values()),
        ...(Object.keys(workflowMcpServers).length > 0 ? { mcpServers: workflowMcpServers } : {}),
    };
    
    // Output to stdout
    console.log(JSON.stringify(workflow, null, 2));
}
