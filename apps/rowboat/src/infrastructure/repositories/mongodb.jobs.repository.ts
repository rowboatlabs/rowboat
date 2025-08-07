import { z } from "zod";
import { ObjectId } from "mongodb";
import { db } from "@/app/lib/mongodb";
import { IJobsRepository } from "@/src/application/repositories/jobs.repository.interface";
import { Job } from "@/src/entities/models/job";
import { JobAcquisitionError } from "@/src/entities/errors/job-errors";
import { NotFoundError } from "@/src/entities/errors/common";

/**
 * MongoDB document schema for Job.
 * Excludes the 'id' field as it's represented by MongoDB's '_id'.
 */
const DocSchema = Job.omit({
    id: true,
});

/**
 * Schema for creating a new job.
 */
const createJobSchema = Job.pick({
    reason: true,
    projectId: true,
    input: true,
});

/**
 * Schema for updating an existing job.
 */
const updateJobSchema = Job.pick({
    status: true,
    output: true,
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
    async create(data: z.infer<typeof createJobSchema>): Promise<z.infer<typeof Job>> {
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
    async update(id: string, data: z.infer<typeof updateJobSchema>): Promise<z.infer<typeof Job>> {
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
}
