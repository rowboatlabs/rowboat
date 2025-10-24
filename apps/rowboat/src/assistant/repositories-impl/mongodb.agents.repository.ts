import { CreateSchema, IAgentsRepository } from "@/src/assistant/repositories/agents.repository.interface";
import { db } from "@/app/lib/mongodb";
import { z } from "zod";
import { Agent } from "@/src/assistant/entities/agent";
import { Filter, ObjectId } from "mongodb";
import { NotFoundError } from "@/src/entities/errors/common";
import { PaginatedList } from "@/src/entities/common/paginated-list";

const docSchema = Agent
    .omit({ id: true })
    .extend({
        deleted: z.boolean().optional(),
    });

export class MongoDBAgentsRepository implements IAgentsRepository {
    private readonly collection = db.collection<z.infer<typeof docSchema>>("agents");

    async create(data: z.infer<typeof CreateSchema>): Promise<z.infer<typeof Agent>> {
        const now = new Date().toISOString();
        const _id = new ObjectId();
        const doc = {
            ...data,
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


    async list(tenantId: string, cursor?: string, limit: number = 10): Promise<z.infer<ReturnType<typeof PaginatedList<typeof Agent>>>> {
        const query: Filter<z.infer<typeof docSchema>> = { tenantId, deleted: { $ne: true } };

        if (cursor) {
            query._id = { $lt: new ObjectId(cursor) };
        }

        const results = await this.collection
            .find(query)
            .sort({ _id: -1 })
            .limit(limit + 1) // Fetch one extra to determine if there's a next page
            .toArray();

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

    async fetch(agentId: string): Promise<z.infer<typeof Agent> | null> {
        const result = await this.collection.findOne({ _id: new ObjectId(agentId) });
        if (!result) return null;
        const { _id, ...rest } = result;
        return {
            ...rest,
            id: _id.toString(),
        };
    }

    async updateCurrentVersion(agentId: string, versionId: string): Promise<z.infer<typeof Agent>> {
        const result = await this.collection.findOneAndUpdate({
            _id: new ObjectId(agentId)
        }, {
            $set: {
                currentVersion: versionId,
            },
        }, { returnDocument: "after" as const });
        if (!result) throw new NotFoundError(`Agent ${agentId} not found`);
        const { _id, ...rest } = result;
        return {
            ...rest,
            id: _id.toString(),
        };
    }

    async delete(agentId: string): Promise<boolean> {
        const result = await this.collection.updateOne({
            _id: new ObjectId(agentId),
            deleted: { $ne: true },
        }, {
            $set: { deleted: true },
        });
        return result.modifiedCount > 0;
    }
}