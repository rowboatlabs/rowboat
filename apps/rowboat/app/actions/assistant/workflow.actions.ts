"use server";

import { z } from "zod";
import { Edge, Workflow } from "@/src/assistant/entities/workflow";
import { Node } from "@/src/assistant/entities/workflow";
import { PaginatedList } from "@/src/entities/common/paginated-list";

export const listWorkflows = async (request: {
    cursor?: string;
    limit?: number;
}): Promise<z.infer<ReturnType<typeof PaginatedList<typeof Workflow>>>> => {
    throw new Error("Not implemented");
};

export const vectorSearchWorkflows = async (request: {
    query: string;
}): Promise<z.infer<typeof Workflow>[]> => {
    throw new Error("Not implemented");
};

export const fetchWorkflow = async (workflowId: string): Promise<z.infer<typeof Workflow>> => {
    throw new Error("Not implemented");
};

export const createWorkflow = async (request: {
    name: string;
    description: string;
}): Promise<z.infer<typeof Workflow>> => {
    throw new Error("Not implemented");
};

export const updateWorkflow = async (request: {
    workflowId: string;
    name: string;
    description: string;
}): Promise<z.infer<typeof Workflow>> => {
    throw new Error("Not implemented");
};

export const updateWorkflowDAG = async (request: {
    workflowId: string;
    nodes: z.infer<typeof Node>[];
    edges: z.infer<typeof Edge>[];
}): Promise<z.infer<typeof Workflow>> => {
    throw new Error("Not implemented");
};

export const deleteWorkflow = async (workflowId: string): Promise<void> => {
    throw new Error("Not implemented");
};