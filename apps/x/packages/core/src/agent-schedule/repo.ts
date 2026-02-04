import { WorkDir } from "../config/config.js";
import { AgentScheduleConfig, AgentScheduleEntry } from "@x/shared/dist/agent-schedule.js";
import fs from "fs/promises";
import path from "path";
import z from "zod";

const DEFAULT_AGENT_SCHEDULES: z.infer<typeof AgentScheduleConfig>["agents"] = {};

export interface IAgentScheduleRepo {
    ensureConfig(): Promise<void>;
    getConfig(): Promise<z.infer<typeof AgentScheduleConfig>>;
    upsert(agentName: string, entry: z.infer<typeof AgentScheduleEntry>): Promise<void>;
    delete(agentName: string): Promise<void>;
}

export class FSAgentScheduleRepo implements IAgentScheduleRepo {
    private readonly configPath = path.join(WorkDir, "config", "agent-schedule.json");

    async ensureConfig(): Promise<void> {
        try {
            await fs.access(this.configPath);
        } catch {
            await fs.writeFile(this.configPath, JSON.stringify({ agents: DEFAULT_AGENT_SCHEDULES }, null, 2));
        }
    }

    async getConfig(): Promise<z.infer<typeof AgentScheduleConfig>> {
        const config = await fs.readFile(this.configPath, "utf8");
        return AgentScheduleConfig.parse(JSON.parse(config));
    }

    async upsert(agentName: string, entry: z.infer<typeof AgentScheduleEntry>): Promise<void> {
        const conf = await this.getConfig();
        conf.agents[agentName] = entry;
        await fs.writeFile(this.configPath, JSON.stringify(conf, null, 2));
    }

    async delete(agentName: string): Promise<void> {
        const conf = await this.getConfig();
        delete conf.agents[agentName];
        await fs.writeFile(this.configPath, JSON.stringify(conf, null, 2));
    }
}
