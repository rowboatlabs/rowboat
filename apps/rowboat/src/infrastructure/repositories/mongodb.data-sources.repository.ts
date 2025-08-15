import { z } from "zod";
import { ObjectId } from "mongodb";
import { db } from "@/app/lib/mongodb";
import { DataSource } from "@/src/entities/models/data-source";
import {
    CreateSchema,
    IDataSourcesRepository,
    ListFiltersSchema,
    ReleasePayloadSchema,
    UpdateSchema,
} from "@/src/application/repositories/data-sources.repository.interface";
import { PaginatedList } from "@/src/entities/common/paginated-list";
import { NotFoundError } from "@/src/entities/errors/common";

/**
 * MongoDB document schema for DataSource.
 * Excludes the 'id' field as it's represented by MongoDB's '_id'.
 */
const DocSchema = DataSource.omit({ id: true });

/**
 * MongoDB implementation of the DataSources repository.
 */
export class MongoDBDataSourcesRepository implements IDataSourcesRepository {
    private readonly collection = db.collection<z.infer<typeof DocSchema>>("sources");

    async create(data: z.infer<typeof CreateSchema>): Promise<z.infer<typeof DataSource>> {
        const now = new Date().toISOString();
        const _id = new ObjectId();

        const doc: z.infer<typeof DocSchema> = {
            ...data,
            active: true,
            attempts: 0,
            version: 1,
            createdAt: now,
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

    async fetch(id: string): Promise<z.infer<typeof DataSource> | null> {
        const result = await this.collection.findOne({ _id: new ObjectId(id) });
        if (!result) return null;

        const { _id, ...rest } = result;
        return {
            ...rest,
            id: _id.toString(),
        };
    }

    async list(
        projectId: string,
        filters?: z.infer<typeof ListFiltersSchema>,
        cursor?: string,
        limit: number = 50
    ): Promise<z.infer<ReturnType<typeof PaginatedList<typeof DataSource>>>> {
        const query: any = { projectId, status: { $ne: "deleted" } };

        // Default behavior: exclude deleted unless explicitly asked for
        if (filters?.deleted === true) {
            query.status = "deleted";
        }

        if (typeof filters?.active === "boolean") {
            query.active = filters.active;
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
        const items = results.slice(0, _limit).map((doc: any) => {
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

    async update(
        id: string,
        data: z.infer<typeof UpdateSchema>,
        bumpVersion?: boolean
    ): Promise<z.infer<typeof DataSource>> {
        const now = new Date().toISOString();

        const result = await this.collection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            {
                $set: {
                    ...data,
                    lastUpdatedAt: now,
                },
                ...(bumpVersion ? { $inc: { version: 1 } } : {}),
            },
            { returnDocument: "after" }
        );

        if (!result) {
            throw new NotFoundError(`DataSource ${id} not found`);
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

    async deleteByProjectId(projectId: string): Promise<void> {
        await this.collection.deleteMany({ projectId });
    }

    async pollDeleteJob(types: string[]): Promise<z.infer<typeof DataSource> | null> {
        const result = await this.collection.findOneAndUpdate({
            status: "deleted",
            "data.type": { $in: types },
            $or: [
                { attempts: { $exists: false } },
                { attempts: { $lte: 3 } }
            ]
        }, { $set: { lastAttemptAt: new Date().toISOString() }, $inc: { attempts: 1 } }, { returnDocument: "after", sort: { createdAt: 1 } });
        if (!result) return null;

        const { _id, ...rest } = result;
        return { ...rest, id: _id.toString() };
    }

    async pollPendingJob(types: string[]): Promise<z.infer<typeof DataSource> | null> {
        const now = Date.now();

        const result = await this.collection.findOneAndUpdate({
            $and: [
                { 'data.type': { $in: types } },
                {
                    $or: [
                        // if the job has never been attempted
                        {
                            status: "pending",
                            attempts: 0,
                        },
                        // if the job was attempted but wasn't completed in the last hour
                        {
                            status: "pending",
                            lastAttemptAt: { $lt: new Date(now - 60 * 60 * 1000).toISOString() },
                        },
                        // if the job errored out but hasn't been retried 3 times yet
                        {
                            status: "error",
                            attempts: { $lt: 3 },
                        },
                        // if the job errored out but hasn't been retried in the last hr
                        {
                            status: "error",
                            lastAttemptAt: { $lt: new Date(now - 60 * 60 * 1000).toISOString() },
                        },
                    ]
                }
            ]
        }, {
            $set: {
                status: "pending",
                lastAttemptAt: new Date().toISOString(),
            },
            $inc: {
                attempts: 1
            },
        }, {
            returnDocument: "after", sort: { createdAt: 1 }
        });
        if (!result) return null;

        const { _id, ...rest } = result;
        return { ...rest, id: _id.toString() };
    }

    async release(id: string, version: number, updates: z.infer<typeof ReleasePayloadSchema>): Promise<void> {
        await this.collection.updateOne({
            _id: new ObjectId(id),
            version,
        }, { $set: {
            ...updates,
            lastUpdatedAt: new Date().toISOString(),
        } });
    }
}