import { Agent } from "@/src/assistant/entities/agent";
import { z } from "zod";
import { PaginatedList } from "@/src/entities/common/paginated-list";

export const CreateSchema = Agent.pick({
    tenantId: true,
});

export interface IAgentsRepository {
    create(data: z.infer<typeof CreateSchema>): Promise<z.infer<typeof Agent>>;

    fetch(agentId: string): Promise<z.infer<typeof Agent> | null>;

    list(tenantId: string, cursor?: string, limit?: number): Promise<z.infer<ReturnType<typeof PaginatedList<typeof Agent>>>>;

    updateCurrentVersion(agentId: string, versionId: string): Promise<z.infer<typeof Agent>>;

    delete(agentId: string): Promise<boolean>;
}