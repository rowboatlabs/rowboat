import { z } from "zod";
import { Filter, ObjectId } from "mongodb";
import { db } from "@/app/lib/mongodb";
import { DataSourceDoc } from "@/src/entities/models/data-source-doc";
import {
    CreateSchema,
    IDataSourceDocsRepository,
    ListFiltersSchema,
    UpdateSchema,
} from "@/src/application/repositories/data-source-docs.repository.interface";
import { PaginatedList } from "@/src/entities/common/paginated-list";
import { NotFoundError } from "@/src/entities/errors/common";

/**
 * MongoDB document schema for DataSourceDoc.
 * Excludes the 'id' field as it's represented by MongoDB's '_id'.
 */
const DocSchema = DataSourceDoc.omit({ id: true });

/**
 * MongoDB implementation of the DataSourceDocs repository.
 */
export class MongoDBDataSourceDocsRepository implements IDataSourceDocsRepository {
    private readonly collection = db.collection<z.infer<typeof DocSchema>>("source_docs");

    async bulkCreate(projectId: string, sourceId: string, data: z.infer<typeof CreateSchema>[]): Promise<string[]> {
        const now = new Date().toISOString();

        const result = await this.collection.insertMany(data.map(doc => {
            return {
                projectId,
                sourceId,
                name: doc.name,
                version: 1,
                createdAt: now,
                lastUpdatedAt: null,
                content: null,
                attempts: 0,
                error: null,
                data: doc.data,
                status: "pending",
            }
        }));

        return Object.values(result.insertedIds).map(id => id.toString());
    }

    async fetch(id: string): Promise<z.infer<typeof DataSourceDoc> | null> {
        const result = await this.collection.findOne({ _id: new ObjectId(id) });
        if (!result) return null;

        const { _id, ...rest } = result;
        return {
            ...rest,
            id: _id.toString(),
        };
    }

    async bulkFetch(ids: string[]): Promise<z.infer<typeof DataSourceDoc>[]> {
        const results = await this.collection.find({ _id: { $in: ids.map(id => new ObjectId(id)) } }).toArray();
        return results.map(result => {
            const { _id, ...rest } = result;
            return { ...rest, id: _id.toString() };
        });
    }

    async list(
        sourceId: string,
        filters?: z.infer<typeof ListFiltersSchema>,
        cursor?: string,
        limit: number = 50
    ): Promise<z.infer<ReturnType<typeof PaginatedList<typeof DataSourceDoc>>>> {
        const query: Filter<z.infer<typeof DocSchema>> = { sourceId, status: { $ne: "deleted" } };

        if (filters?.status && filters.status.length > 0) {
            query.status = { $in: filters.status };
        }

        if (cursor) {
            query._id = { $lt: new ObjectId(cursor) };
        }

        const _limit = Math.min(limit, 50);

        const results = await this.collection
            .find(query)
            .sort({ _id: -1 })
            .limit(_limit + 1)
            .toArray();

        const hasNextPage = results.length > _limit;
        const items = results.slice(0, _limit).map((doc) => {
            const { _id, ...rest } = doc;
            return {
                ...rest,
                id: _id.toString(),
            };
        });

        return {
            items,
            nextCursor: hasNextPage ? results[_limit - 1]._id.toString() : null,
        };
    }

    async markSourceDocsPending(sourceId: string): Promise<void> {
        await this.collection.updateMany(
            { sourceId },
            {
                $set: {
                    status: "pending",
                    lastUpdatedAt: new Date().toISOString(),
                    attempts: 0,
                },
            },
        );
    }

    async markAsDeleted(id: string): Promise<void> {
        await this.collection.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    status: "deleted",
                    lastUpdatedAt: new Date().toISOString(),
                },
            },
        );
    }

    async updateByVersion(
        id: string,
        version: number,
        data: z.infer<typeof UpdateSchema>
    ): Promise<z.infer<typeof DataSourceDoc>> {
        const result = await this.collection.findOneAndUpdate(
            { _id: new ObjectId(id), version },
            {
                $set: {
                    ...data,
                    lastUpdatedAt: new Date().toISOString(),
                },
            },
            { returnDocument: "after" }
        );

        if (!result) {
            throw new NotFoundError(`DataSourceDoc ${id} not found or version mismatch`);
        }

        const { _id, ...rest } = result;
        return {
            ...rest,
            id: _id.toString(),
        };
    }

    async delete(id: string): Promise<boolean> {
        const result = await this.collection.deleteOne({ _id: new ObjectId(id) });
        return result.deletedCount > 0;
    }

    async deleteBySourceId(sourceId: string): Promise<void> {
        await this.collection.deleteMany({ sourceId });
    }

    async deleteByProjectId(projectId: string): Promise<void> {
        await this.collection.deleteMany({ projectId });
    }
}