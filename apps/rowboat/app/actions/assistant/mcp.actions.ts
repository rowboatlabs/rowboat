"use server";

import { MCPServer } from "@/app/lib/types/types";
import { PaginatedList } from "@/src/entities/common/paginated-list";
import { z } from "zod";

export const listMCPServers = async (request: {
    cursor?: string;
    limit?: number;
}): Promise<z.infer<ReturnType<typeof PaginatedList<typeof MCPServer>>>> => {
    throw new Error("Not implemented");
};

export const fetchMCPServer = async (mcpServerId: string): Promise<z.infer<typeof MCPServer>> => {
    throw new Error("Not implemented");
};

export const createMCPServer = async (request: {
    name: string;
    description: string;
}): Promise<z.infer<typeof MCPServer>> => {
    throw new Error("Not implemented");
};

export const updateMCPServer = async (request: {
    mcpServerId: string;
    name: string;
    description: string;
}): Promise<z.infer<typeof MCPServer>> => {
    throw new Error("Not implemented");
};

export const deleteMCPServer = async (mcpServerId: string): Promise<void> => {
    throw new Error("Not implemented");
};