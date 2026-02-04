import { WorkDir } from "../config/config.js";
import { AgentScheduleState, AgentScheduleStateEntry } from "@x/shared/dist/agent-schedule-state.js";
import fs from "fs/promises";
import path from "path";
import z from "zod";

const DEFAULT_AGENT_SCHEDULE_STATE: z.infer<typeof AgentScheduleState>["agents"] = {};

export interface IAgentScheduleStateRepo {
    ensureState(): Promise<void>;
    getState(): Promise<z.infer<typeof AgentScheduleState>>;
    getAgentState(agentName: string): Promise<z.infer<typeof AgentScheduleStateEntry> | null>;
    updateAgentState(agentName: string, entry: Partial<z.infer<typeof AgentScheduleStateEntry>>): Promise<void>;
    setAgentState(agentName: string, entry: z.infer<typeof AgentScheduleStateEntry>): Promise<void>;
    deleteAgentState(agentName: string): Promise<void>;
}

export class FSAgentScheduleStateRepo implements IAgentScheduleStateRepo {
    private readonly statePath = path.join(WorkDir, "config", "agent-schedule-state.json");

    async ensureState(): Promise<void> {
        try {
            await fs.access(this.statePath);
        } catch {
            await fs.writeFile(this.statePath, JSON.stringify({ agents: DEFAULT_AGENT_SCHEDULE_STATE }, null, 2));
        }
    }

    async getState(): Promise<z.infer<typeof AgentScheduleState>> {
        const state = await fs.readFile(this.statePath, "utf8");
        return AgentScheduleState.parse(JSON.parse(state));
    }

    async getAgentState(agentName: string): Promise<z.infer<typeof AgentScheduleStateEntry> | null> {
        const state = await this.getState();
        return state.agents[agentName] ?? null;
    }

    async updateAgentState(agentName: string, entry: Partial<z.infer<typeof AgentScheduleStateEntry>>): Promise<void> {
        const state = await this.getState();
        const existing = state.agents[agentName] ?? {
            status: "scheduled" as const,
            startedAt: null,
            lastRunAt: null,
            nextRunAt: null,
            lastError: null,
            runCount: 0,
        };
        state.agents[agentName] = { ...existing, ...entry };
        await fs.writeFile(this.statePath, JSON.stringify(state, null, 2));
    }

    async setAgentState(agentName: string, entry: z.infer<typeof AgentScheduleStateEntry>): Promise<void> {
        const state = await this.getState();
        state.agents[agentName] = entry;
        await fs.writeFile(this.statePath, JSON.stringify(state, null, 2));
    }

    async deleteAgentState(agentName: string): Promise<void> {
        const state = await this.getState();
        delete state.agents[agentName];
        await fs.writeFile(this.statePath, JSON.stringify(state, null, 2));
    }
}
