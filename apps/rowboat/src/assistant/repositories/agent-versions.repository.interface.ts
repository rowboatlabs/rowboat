import { z } from "zod";
import { PaginatedList } from "@/src/entities/common/paginated-list";
import { AgentVersion } from "../entities/agent-version";

export const CreateSchema = AgentVersion.pick({
    agentId: true,
    name: true,
    description: true,
    instructions: true,
    toolRefs: true,
});

export interface IAgentVersionsRepository {
    create(agentId: string, version: string, data: z.infer<typeof CreateSchema>): Promise<z.infer<typeof AgentVersion>>;

    list(agentId: string, cursor?: string, limit?: number): Promise<z.infer<ReturnType<typeof PaginatedList<typeof AgentVersion>>>>;

    fetch(agentId: string, version: string): Promise<z.infer<typeof AgentVersion> | null>;
}