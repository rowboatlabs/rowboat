import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";
import { z } from "zod";
import { Agent } from "../entities/agent.js";
import { WorkDir } from "../config/config.js";
import { McpServerConfig, McpServerDefinition } from "../entities/mcp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PackageRoot = path.resolve(__dirname, "../../..");
const ExamplesDir = path.join(PackageRoot, "examples");

const ExampleSchema = z.object({
    id: z.string().min(1),
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
        await fs.access(examplePath);
        return await fs.readFile(examplePath, "utf8");
    } catch (error) {
        const availableExamples = await listAvailableExamples();
        const listMessage = availableExamples.length
            ? `Available examples: ${availableExamples.join(", ")}`
            : "No packaged examples were found.";
        throw new Error(`Unknown example '${exampleName}'. ${listMessage}`);
    }
}

export async function listAvailableExamples(): Promise<string[]> {
    try {
        const entries = await fs.readdir(ExamplesDir);
        return entries
            .filter((entry) => entry.endsWith(".json"))
            .map((entry) => entry.replace(/\.json$/, ""))
            .sort();
    } catch {
        return [];
    }
}

async function writeAgents(agents: z.infer<typeof Agent>[]) {
    await fs.mkdir(path.join(WorkDir, "agents"), { recursive: true });
    await Promise.all(
        agents.map(async (agent) => {
            const agentPath = path.join(WorkDir, "agents", `${agent.name}.json`);
            await fs.writeFile(agentPath, JSON.stringify(agent, null, 2), "utf8");
        }),
    );
}

async function mergeMcpServers(servers: Record<string, z.infer<typeof McpServerDefinition>>) {
    const result = { added: [] as string[], skipped: [] as string[] };
    if (!servers || Object.keys(servers).length === 0) {
        return result;
    }
    const configPath = path.join(WorkDir, "config", "mcp.json");
    let currentConfig: z.infer<typeof McpServerConfig> = { mcpServers: {} };
    try {
        const contents = await fs.readFile(configPath, "utf8");
        currentConfig = McpServerConfig.parse(JSON.parse(contents));
    } catch (error: any) {
        if (error?.code !== "ENOENT") {
            throw new Error(`Unable to read MCP config: ${error.message ?? error}`);
        }
    }
    let modified = false;
    for (const [name, definition] of Object.entries(servers)) {
        if (currentConfig.mcpServers[name]) {
            result.skipped.push(name);
            continue;
        }
        currentConfig.mcpServers[name] = definition;
        result.added.push(name);
        modified = true;
    }
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    if (modified) {
        await fs.writeFile(configPath, JSON.stringify(currentConfig, null, 2), "utf8");
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
    };
}
