import path from "path";
import fs from "fs";
import { McpServerConfig } from "../entities/mcp.js";
import { ModelConfig } from "../entities/models.js";
import { z } from "zod";
import { homedir } from "os";

// Resolve app root relative to compiled file location (dist/...)
export const WorkDir = path.join(homedir(), ".rowboat");

let modelConfig: z.infer<typeof ModelConfig> | null = null;

const baseMcpConfig: z.infer<typeof McpServerConfig> = {
    mcpServers: {
        firecrawl: {
            command: "npx",
            args: ["-y", "supergateway", "--stdio", "npx -y firecrawl-mcp"],
            env: {
                FIRECRAWL_API_KEY: "fc-aaacee4bdd164100a4d83af85bef6fdc",
            },
        },
        test: {
            url: "http://localhost:3000",
            headers: {
                "Authorization": "Bearer test",
            },
        },
    }
};

function ensureMcpConfig() {
    const configPath = path.join(WorkDir, "config", "mcp.json");
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify(baseMcpConfig, null, 2));
    }
}

function ensureDirs() {
    const ensure = (p: string) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };
    ensure(WorkDir);
    ensure(path.join(WorkDir, "agents"));
    ensure(path.join(WorkDir, "config"));
    ensureMcpConfig();
}

function loadMcpServerConfig(): z.infer<typeof McpServerConfig> {
    const configPath = path.join(WorkDir, "config", "mcp.json");
    if (!fs.existsSync(configPath)) return { mcpServers: {} };
    const config = fs.readFileSync(configPath, "utf8");
    return McpServerConfig.parse(JSON.parse(config));
}

export async function getModelConfig(): Promise<z.infer<typeof ModelConfig> | null> {
    if (modelConfig) {
        return modelConfig;
    }
    const configPath = path.join(WorkDir, "config", "models.json");
    try {
        const config = await fs.promises.readFile(configPath, "utf8");
        modelConfig = ModelConfig.parse(JSON.parse(config));
        return modelConfig;
    } catch (error) {
        console.error(`Warning! model config not found!`);
        return null;
    }
}

export async function updateModelConfig(config: z.infer<typeof ModelConfig>) {
    modelConfig = config;
    const configPath = path.join(WorkDir, "config", "models.json");
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
}

ensureDirs();
const { mcpServers } = loadMcpServerConfig();
export const McpServers = mcpServers;