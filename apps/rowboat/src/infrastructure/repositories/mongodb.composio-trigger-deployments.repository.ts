import { z } from "zod";
import { ObjectId } from "mongodb";
import { db } from "@/app/lib/mongodb";
import { CreateDeploymentSchema, IComposioTriggerDeploymentsRepository } from "@/src/application/repositories/composio-trigger-deployments.repository.interface";
import { ComposioTriggerDeployment } from "@/src/entities/models/composio-trigger-deployment";
import { PaginatedList } from "@/src/entities/common/paginated-list";

/**
 * MongoDB document schema for ComposioTriggerDeployment.
 * Excludes the 'id' field as it's represented by MongoDB's '_id'.
 */
const DocSchema = ComposioTriggerDeployment.omit({
    id: true,
});

/**
 * MongoDB implementation of the ComposioTriggerDeploymentsRepository.
 * 
 * This repository manages Composio trigger deployments in MongoDB,
 * providing CRUD operations and paginated queries for deployments.
 */
export class MongodbComposioTriggerDeploymentsRepository implements IComposioTriggerDeploymentsRepository {
    private readonly collection = db.collection<z.infer<typeof DocSchema>>("composio_trigger_deployments");

    constructor() {
        // Create indexes for efficient querying
        this.createIndexes();
    }

    /**
     * Creates the necessary indexes for efficient querying.
     */
    private async createIndexes(): Promise<void> {
        await this.collection.createIndexes([
            { key: { projectId: 1 }, name: "projectId_idx" },
            { key: { triggerTypeSlug: 1 }, name: "triggerTypeSlug_idx" },
            { key: { connectedAccountId: 1 }, name: "connectedAccountId_idx" },
            { key: { triggerId: 1 }, name: "triggerId_idx" },
        ]);
    }

    /**
     * Creates a new Composio trigger deployment.
     */
    async create(data: z.infer<typeof CreateDeploymentSchema>): Promise<z.infer<typeof ComposioTriggerDeployment>> {
        const now = new Date().toISOString();
        const _id = new ObjectId();

        const doc = {
            ...data,
            createdAt: now,
            updatedAt: now,
        };

        await this.collection.insertOne({
            ...doc,
            _id,
        });

        return {
            ...doc,
            id: _id.toString(),
        };
    }

    /**
     * Fetches a trigger deployment by its ID.
     */
    async fetch(id: string): Promise<z.infer<typeof ComposioTriggerDeployment> | null> {
        const result = await this.collection.findOne({ _id: new ObjectId(id) });

        if (!result) {
            return null;
        }

        const { _id, ...rest } = result;

        return {
            ...rest,
            id: _id.toString(),
        };
    }

    /**
     * Deletes a Composio trigger deployment by its ID.
     */
    async delete(id: string): Promise<boolean> {
        const result = await this.collection.deleteOne({
            _id: new ObjectId(id),
        });

        return result.deletedCount > 0;
    }

    /**
     * Fetches a trigger deployment by its trigger type slug and connected account ID.
     */
    async fetchBySlugAndConnectedAccountId(triggerTypeSlug: string, connectedAccountId: string): Promise<z.infer<typeof ComposioTriggerDeployment> | null> {
        const result = await this.collection.findOne({
            triggerTypeSlug,
            connectedAccountId,
        });

        if (!result) {
            return null;
        }

        const { _id, ...rest } = result;

        return {
            ...rest,
            id: _id.toString(),
        };
    }

    /**
     * Retrieves all trigger deployments for a specific project with pagination.
     */
    async listByProjectId(projectId: string, cursor?: string, limit: number = 50): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ComposioTriggerDeployment>>>> {
        const query: any = { projectId };

        if (cursor) {
            query._id = { $gt: new ObjectId(cursor) };
        }

        const results = await this.collection
            .find(query)
            .sort({ _id: 1 })
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

    /**
     * Retrieves all trigger deployments for a specific trigger type with pagination.
     */
    async listByTriggerTypeSlug(triggerTypeSlug: string, cursor?: string, limit: number = 50): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ComposioTriggerDeployment>>>> {
        const query: any = { triggerTypeSlug };

        if (cursor) {
            query._id = { $gt: new ObjectId(cursor) };
        }

        const results = await this.collection
            .find(query)
            .sort({ _id: 1 })
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

    /**
     * Deletes all trigger deployments associated with a specific connected account.
     */
    async deleteByConnectedAccountId(connectedAccountId: string): Promise<number> {
        const result = await this.collection.deleteMany({
            connectedAccountId,
        });

        return result.deletedCount;
    }
}