import { AgentVersion } from "../entities/agent-version";
import { CreateSchema, IAgentVersionsRepository } from "../repositories/agent-versions.repository.interface";
import { z } from "zod";
import { Filter, ObjectId } from "mongodb";
import { db } from "@/app/lib/mongodb";
import { PaginatedList } from "@/src/entities/common/paginated-list";

const docSchema = AgentVersion
    .omit({ id: true })
    .extend({
        deleted: z.boolean().optional(),
    });

export class MongoDBAgentVersionsRepository implements IAgentVersionsRepository {
    private readonly collection = db.collection<z.infer<typeof docSchema>>("agent_versions");
    async create(data: z.infer<typeof CreateSchema>): Promise<z.infer<typeof AgentVersion>> {
        const now = new Date().toISOString();
        const _id = new ObjectId();
        const doc = {
            ...data,
            version: nanoid(),
            createdAt: now,
        };
        await this.collection.insertOne({
            _id,
            ...doc,
        });
        return {
            ...doc,
            id: _id.toString(),
        };
    }

    async list(agentId: string, cursor?: string, limit?: number): Promise<z.infer<ReturnType<typeof PaginatedList<typeof AgentVersion>>>> {
        const query: Filter<z.infer<typeof docSchema>> = { agentId, deleted: { $ne: true } };
        if (cursor) {
            query._id = { $lt: new ObjectId(cursor) };
        }
        const results = await this.collection.find(query).sort({ _id: -1 }).limit(limit + 1).toArray();
        const hasNextPage = results.length > limit;
        const items = results.slice(0, limit).map(doc => {
            const { _id, ...rest } = doc;
            return {
                ...rest,
                id: _id.toString(),
            };
        });
        return {
            items,
            nextCursor: hasNextPage ? results[limit - 1]._id.toString() : null,
        };
    }

    async fetch(agentId: string, versionId: string): Promise<z.infer<typeof AgentVersion> | null> {
        const result = await this.collection.findOne({ _id: new ObjectId(versionId), agentId, deleted: { $ne: true } });
        if (!result) return null;
        const { _id, ...rest } = result;
        return {
            ...rest,
            id: _id.toString(),
        };
    }
}