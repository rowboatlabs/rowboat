import { AgentState, streamAgent } from "./application/lib/agent.js";
import { StreamRenderer } from "./application/lib/stream-renderer.js";
import { stdin as input, stdout as output } from "node:process";
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WorkDir, getModelConfig, updateModelConfig } from "./application/config/config.js";
import { RunEvent } from "./application/entities/run-events.js";
import { createInterface, Interface } from "node:readline/promises";
import { ToolCallPart } from "./application/entities/message.js";
import { Agent } from "./application/entities/agent.js";
import { McpServerConfig, McpServerDefinition } from "./application/entities/mcp.js";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PackageRoot = path.resolve(__dirname, "..");
const ExamplesDir = path.join(PackageRoot, "examples");

export async function updateState(agent: string, runId: string) {
    const state = new AgentState(agent, runId);
    // If running in a TTY, read run events from stdin line-by-line
    if (!input.isTTY) {
        return;
    }

    const rl = createInterface({ input, crlfDelay: Infinity });
    try {
        for await (const line of rl) {
            if (line.trim() === "") {
                continue;
            }
            const event = RunEvent.parse(JSON.parse(line));
            state.ingestAndLog(event);
        }
    } finally {
        rl.close();
    }
}

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
    // check if model config is required
    const c = await getModelConfig();
    if (!c) {
        await modelConfig();
    }

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
    const config = await getModelConfig();

    const rl = createInterface({ input, output });
    try {
        const flavors = [
            "openai",
            "anthropic",
            "google",
            "ollama",
            "openai-compatible",
            "openrouter",
        ] as const;
        const defaultBaseUrls: Record<(typeof flavors)[number], string> = {
            openai: "https://api.openai.com/v1",
            anthropic: "https://api.anthropic.com/v1",
            google: "https://generativelanguage.googleapis.com/v1beta",
            ollama: "http://localhost:11434",
            "openai-compatible": "http://localhost:8080/v1",
            openrouter: "https://openrouter.ai/api/v1",
        };
        const defaultModels: Record<(typeof flavors)[number], string> = {
            openai: "gpt-5.1",
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

        const flavorPromptLines = flavors
            .map((f, idx) => `  ${idx + 1}. ${f}`)
            .join("\n");
        const flavorAnswer = await rl.question(
            `Select a provider type:\n${flavorPromptLines}\nEnter number or name` +
            (currentProvider ? ` [${currentProvider}]` : "") +
            ": ",
        );
        let selectedFlavorRaw = flavorAnswer.trim();
        let selectedFlavor: (typeof flavors)[number] | null = null;
        if (selectedFlavorRaw === "" && currentProvider && (flavors as readonly string[]).includes(currentProvider)) {
            selectedFlavor = currentProvider as (typeof flavors)[number];
        } else if (/^\d+$/.test(selectedFlavorRaw)) {
            const idx = parseInt(selectedFlavorRaw, 10) - 1;
            if (idx >= 0 && idx < flavors.length) {
                selectedFlavor = flavors[idx];
            }
        } else if ((flavors as readonly string[]).includes(selectedFlavorRaw)) {
            selectedFlavor = selectedFlavorRaw as (typeof flavors)[number];
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

            const newConfig = {
                providers: { ...(config?.providers || {}) },
                defaults: {
                    provider: providerName!,
                    model,
                },
            };
            await updateModelConfig(newConfig as any);
            console.log(`Model configuration updated. Provider set to '${providerName}'.`);
            return;
        }

        const providerNameAns = await rl.question(
            `Enter a name/alias for this provider [${selectedFlavor}]: `,
        );
        providerName = providerNameAns.trim() || selectedFlavor;

        const baseUrlDefault = defaultBaseUrls[selectedFlavor] || "";
        const baseUrlAns = await rl.question(
            `Enter baseURL for ${selectedFlavor} [${baseUrlDefault}]: `,
        );
        const baseURL = (baseUrlAns.trim() || baseUrlDefault) || undefined;

        const apiKeyAns = await rl.question(
            `Enter API key for ${selectedFlavor} (leave blank to skip): `,
        );
        const apiKey = apiKeyAns.trim() || undefined;

        const modelDefault = defaultModels[selectedFlavor];
        const modelAns = await rl.question(
            `Specify model for ${selectedFlavor} [${modelDefault}]: `,
        );
        const model = modelAns.trim() || modelDefault;

        const mergedProviders = {
            ...(config?.providers || {}),
            [providerName]: {
                flavor: selectedFlavor,
                ...(apiKey ? { apiKey } : {}),
                ...(baseURL ? { baseURL } : {}),
            },
        };
        const newConfig = {
            providers: mergedProviders,
            defaults: {
                provider: providerName,
                model,
            },
        };

        await updateModelConfig(newConfig as any);
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

const ExampleSchema = z.object({
    id: z.string().min(1),
    "post-install-instructions": z.string().optional(),
    description: z.string().optional(),
    entryAgent: z.string().optional(),
    agents: z.array(Agent).min(1),
    mcpServers: z.record(z.string(), McpServerDefinition).optional(),
}).refine(
    (data) => !data.entryAgent || data.agents.some((agent) => agent.name === data.entryAgent),
    {
        message: "entryAgent must reference one of the defined agents",
        path: ["entryAgent"],
    },
);

async function readExampleFile(exampleName: string): Promise<string> {
    const examplePath = path.join(ExamplesDir, `${exampleName}.json`);
    try {
        return await fsp.readFile(examplePath, "utf8");
    } catch (error: any) {
        if (error?.code === "ENOENT") {
            const availableExamples = await listAvailableExamples();
            const listMessage = availableExamples.length
                ? `Available examples: ${availableExamples.join(", ")}`
                : "No packaged examples were found.";
            throw new Error(`Unknown example '${exampleName}'. ${listMessage}`);
        }
        // Re-throw other errors (permission issues, etc.)
        throw error;
    }
}

async function listAvailableExamples(): Promise<string[]> {
    try {
        const entries = await fsp.readdir(ExamplesDir);
        return entries
            .filter((entry) => entry.endsWith(".json"))
            .map((entry) => entry.replace(/\.json$/, ""))
            .sort();
    } catch {
        return [];
    }
}

async function writeAgents(agents: z.infer<typeof Agent>[]) {
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

export async function importExample(exampleName: string) {
    const raw = await readExampleFile(exampleName);
    const parsed = ExampleSchema.parse(JSON.parse(raw));
    const entryAgentName = parsed.entryAgent ?? parsed.agents[0]?.name;
    if (!entryAgentName) {
        throw new Error(`Example '${exampleName}' does not define any agents to run.`);
    }
    const postInstallInstructions = parsed["post-install-instructions"];
    await writeAgents(parsed.agents);
    let serverMerge = { added: [] as string[], skipped: [] as string[] };
    if (parsed.mcpServers) {
        serverMerge = await mergeMcpServers(parsed.mcpServers);
    }
    return {
        id: parsed.id,
        entryAgent: entryAgentName,
        importedAgents: parsed.agents.map((agent) => agent.name),
        addedServers: serverMerge.added,
        skippedServers: serverMerge.skipped,
        postInstallInstructions,
    };
}

export async function listExamples() {
    return listAvailableExamples();
}
