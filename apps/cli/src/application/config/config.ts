import path from "path";
import fs from "fs";
import { McpServerConfig } from "../entities/mcp.js";
import { ModelConfig as ModelConfigT } from "../entities/models.js";
import { z } from "zod";
import { homedir } from "os";

// Resolve app root relative to compiled file location (dist/...)
export const WorkDir = path.join(homedir(), ".rowboat");
export const CopilotDataDir = path.join(WorkDir, "copilot");

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

const baseModelConfig: z.infer<typeof ModelConfigT> = {
    providers: {
        openai: {
            flavor: "openai",
        },
    },
    defaults: {
        provider: "openai",
        model: "gpt-5",
    }
};

function ensureMcpConfig() {
    const configPath = path.join(WorkDir, "config", "mcp.json");
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify(baseMcpConfig, null, 2));
    }
}

function ensureModelConfig() {
    const configPath = path.join(WorkDir, "config", "models.json");
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify(baseModelConfig, null, 2));
    }
}

function ensureDirs() {
    const ensure = (p: string) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };
    ensure(WorkDir);
    ensure(path.join(WorkDir, "agents"));
    ensure(path.join(WorkDir, "config"));
    ensure(CopilotDataDir);
    ensureMcpConfig();
    ensureModelConfig();
}

ensureDirs();

function loadMcpServerConfig(): z.infer<typeof McpServerConfig> {
    const configPath = path.join(WorkDir, "config", "mcp.json");
    if (!fs.existsSync(configPath)) return { mcpServers: {} };
    const config = fs.readFileSync(configPath, "utf8");
    return McpServerConfig.parse(JSON.parse(config));
}

function loadModelConfig(): z.infer<typeof ModelConfigT> {
    const configPath = path.join(WorkDir, "config", "models.json");
    if (!fs.existsSync(configPath)) return baseModelConfig;
    const config = fs.readFileSync(configPath, "utf8");
    return ModelConfigT.parse(JSON.parse(config));
}

const { mcpServers } = loadMcpServerConfig();
export const McpServers = mcpServers;
export const ModelConfig = loadModelConfig();
