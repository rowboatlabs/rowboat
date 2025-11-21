import { AgentState, streamAgent } from "./application/lib/agent.js";
import { StreamRenderer } from "./application/lib/stream-renderer.js";
import { stdin as input, stdout as output } from "node:process";
import fs from "fs";
import path from "path";
import { WorkDir, getModelConfig, updateModelConfig } from "./application/config/config.js";
import { RunEvent } from "./application/entities/run-events.js";
import { createInterface, Interface } from "node:readline/promises";
import { ToolCallPart } from "./application/entities/message.js";
import { keyof, z } from "zod";
import { Flavor, ModelConfig } from "./application/entities/models.js";

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
        const defaultApiKeyEnvVars: Record<z.infer<typeof Flavor>, string> = {
            "rowboat [free]": "",
            openai: "OPENAI_API_KEY",
            anthropic: "ANTHROPIC_API_KEY",
            google: "GOOGLE_GENERATIVE_AI_API_KEY",
            ollama: "",
            "openai-compatible": "",
            openrouter: "",
        };
        const defaultBaseUrls: Record<z.infer<typeof Flavor>, string> = {
            "rowboat [free]": "",
            openai: "https://api.openai.com/v1",
            anthropic: "https://api.anthropic.com/v1",
            google: "https://generativelanguage.googleapis.com/v1beta",
            ollama: "http://localhost:11434",
            "openai-compatible": "http://localhost:8080/v1",
            openrouter: "https://openrouter.ai/api/v1",
        };
        const defaultModels: Record<z.infer<typeof Flavor>, string> = {
            "rowboat [free]": "google/gemini-3-pro-preview",
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

        const mergedProviders = {
            ...(config?.providers || {}),
            [providerName]: {
                flavor: selectedFlavor,
                ...(apiKey ? { apiKey } : {}),
                ...(baseURL ? { baseURL } : {}),
                ...(headers ? { headers } : {}),
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