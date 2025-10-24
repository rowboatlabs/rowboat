"use server";

import { ToolRef } from "@/src/assistant/entities/agent";
import { AgentVersion } from "@/src/assistant/entities/agent-version";
import { z } from "zod";

export const vectorSearchAgents = async (request: {
    query: string;
}): Promise<z.infer<typeof AgentVersion>[]> => {
    throw new Error("Not implemented");
};

export const fetchAgent = async (agentId: string): Promise<z.infer<typeof AgentVersion>> => {
    throw new Error("Not implemented");
};

export const createAgent = async (request: {
    name: string;
    description: string;
    instructions: string;
    toolRefs: z.infer<typeof ToolRef>[];
}): Promise<z.infer<typeof AgentVersion>> => {
    throw new Error("Not implemented");
};

export const updateAgent = async (request: {
    name: string;
    description: string;
}): Promise<z.infer<typeof AgentVersion>> => {
    throw new Error("Not implemented");
};

export const updateAgentInstructions = async (request: {
    agentId: string;
    instructions: string;
}): Promise<z.infer<typeof AgentVersion>> => {
    throw new Error("Not implemented");
};

export const updateAgentToolRefs = async (request: {
    agentId: string;
    toolRefs: z.infer<typeof ToolRef>[];
}): Promise<z.infer<typeof AgentVersion>> => {
    throw new Error("Not implemented");
};

export const deleteAgent = async (request: {
    agentId: string;
}): Promise<void> => {
    throw new Error("Not implemented");
};