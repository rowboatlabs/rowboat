import { z } from "zod";
import { ObjectId } from "mongodb";
import { db } from "@/app/lib/mongodb";
import { CreateJobSchema, IJobsRepository, ListedJobItem, UpdateJobSchema } from "@/src/application/repositories/jobs.repository.interface";
import { Job } from "@/src/entities/models/job";
import { JobAcquisitionError } from "@/src/entities/errors/job-errors";
import { NotFoundError } from "@/src/entities/errors/common";
import { PaginatedList } from "@/src/entities/common/paginated-list";

/**
 * MongoDB document schema for Job.
 * Excludes the 'id' field as it's represented by MongoDB's '_id'.
 */
const DocSchema = Job.omit({
    id: true,
});

/**
 * MongoDB implementation of the JobsRepository.
 * 
 * This repository manages jobs in MongoDB, providing operations for
 * creating, polling, locking, updating, and releasing jobs for worker processing.
 */
export class MongoDBJobsRepository implements IJobsRepository {
    private readonly collection = db.collection<z.infer<typeof DocSchema>>("jobs");

    /**
     * Creates a new job in the system.
     */
    async create(data: z.infer<typeof CreateJobSchema>): Promise<z.infer<typeof Job>> {
        const now = new Date().toISOString();
        const _id = new ObjectId();

        const doc: z.infer<typeof DocSchema> = {
            ...data,
            status: "pending" as const,
            workerId: null,
            lastWorkerId: null,
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

    /**
     * Fetches a job by its unique identifier.
     */
    async fetch(id: string): Promise<z.infer<typeof Job> | null> {
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
     * Polls for the next available job that can be processed by a worker.
     */
    async poll(workerId: string): Promise<z.infer<typeof Job> | null> {
        const now = new Date().toISOString();
        
        // Find and update the next available job atomically
        const result = await this.collection.findOneAndUpdate(
            {
                status: "pending",
                workerId: null,
            },
            {
                $set: {
                    status: "running",
                    workerId,
                    lastWorkerId: workerId,
                    updatedAt: now,
                },
            },
            {
                sort: { createdAt: 1 }, // Process oldest jobs first
                returnDocument: "after",
            }
        );

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
     * Locks a specific job for processing by a worker.
     */
    async lock(id: string, workerId: string): Promise<z.infer<typeof Job>> {
        const now = new Date().toISOString();

        const result = await this.collection.findOneAndUpdate(
            {
                _id: new ObjectId(id),
                status: "pending",
                workerId: null,
            },
            {
                $set: {
                    status: "running",
                    workerId,
                    lastWorkerId: workerId,
                    updatedAt: now,
                },
            },
            {
                returnDocument: "after",
            }
        );

        if (!result) {
            throw new JobAcquisitionError(`Job ${id} is already locked or doesn't exist`);
        }

        const { _id, ...rest } = result;

        return {
            ...rest,
            id: _id.toString(),
        };
    }

    /**
     * Updates an existing job with new status and/or output data.
     */
    async update(id: string, data: z.infer<typeof UpdateJobSchema>): Promise<z.infer<typeof Job>> {
        const now = new Date().toISOString();

        const result = await this.collection.findOneAndUpdate(
            {
                _id: new ObjectId(id),
            },
            {
                $set: {
                    ...data,
                    updatedAt: now,
                },
            },
            {
                returnDocument: "after",
            }
        );

        if (!result) {
            throw new NotFoundError(`Job ${id} not found`);
        }

        const { _id, ...rest } = result;

        return {
            ...rest,
            id: _id.toString(),
        };
    }

    /**
     * Releases a job lock, making it available for other workers.
     */
    async release(id: string): Promise<void> {
        const result = await this.collection.updateOne(
            {
                _id: new ObjectId(id),
            },
            {
                $set: {
                    workerId: null,
                    updatedAt: new Date().toISOString(),
                },
            }
        );

        if (result.matchedCount === 0) {
            throw new NotFoundError(`Job ${id} not found`);
        }
    }

    /**
     * Lists jobs for a specific project with pagination.
     */
    async list(projectId: string, cursor?: string, limit: number = 50): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ListedJobItem>>>> {
        const query: any = { projectId };

        if (cursor) {
            query._id = { $lt: new ObjectId(cursor) };
        }

        const results = await this.collection
            .find(query)
            .sort({ _id: -1 })
            .limit(limit + 1) // Fetch one extra to determine if there's a next page
            .project<z.infer<typeof ListedJobItem> & { _id: ObjectId }>({
                _id: 1,
                projectId: 1,
                status: 1,
                reason: 1,
                createdAt: 1,
                updatedAt: 1,
            })
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
}
