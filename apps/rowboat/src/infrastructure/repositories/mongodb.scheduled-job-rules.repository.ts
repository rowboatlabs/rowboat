import { z } from "zod";
import { ObjectId } from "mongodb";
import { db } from "@/app/lib/mongodb";
import { CreateRuleSchema, IScheduledJobRulesRepository, ListedRuleItem } from "@/src/application/repositories/scheduled-job-rules.repository.interface";
import { ScheduledJobRule } from "@/src/entities/models/scheduled-job-rule";
import { NotFoundError } from "@/src/entities/errors/common";
import { PaginatedList } from "@/src/entities/common/paginated-list";

/**
 * MongoDB document schema for ScheduledJobRule.
 * Excludes the 'id' field as it's represented by MongoDB's '_id'.
 */
const DocSchema = ScheduledJobRule
    .omit({
        id: true,
        nextRunAt: true,
        processedAt: true,
    })
    .extend({
        _id: z.instanceof(ObjectId),
        nextRunAt: z.number(),
        processedAt: z.number().nullable(),
    });

/**
 * Schema for creating documents (without _id field).
 */
const CreateDocSchema = DocSchema.omit({ _id: true });

/**
 * MongoDB implementation of the ScheduledJobRulesRepository.
 * 
 * This repository manages scheduled job rules in MongoDB, providing operations for
 * creating, fetching, polling, processing, and listing rules for worker processing.
 */
export class MongoDBScheduledJobRulesRepository implements IScheduledJobRulesRepository {
    private readonly collection = db.collection<z.infer<typeof DocSchema>>("scheduled_job_rules");

    /**
     * Converts a MongoDB document to a domain model.
     * Handles the conversion of nextRunAt and processedAt from Unix timestamps to ISO strings.
     */
    private convertDocToModel(doc: z.infer<typeof DocSchema>): z.infer<typeof ScheduledJobRule> {
        const { _id, nextRunAt, processedAt, ...rest } = doc;
        return {
            ...rest,
            id: _id.toString(),
            nextRunAt: new Date(nextRunAt * 1000).toISOString(),
            processedAt: processedAt ? new Date(processedAt * 1000).toISOString() : null,
        };
    }

    /**
     * Creates a new scheduled job rule in the system.
     */
    async create(data: z.infer<typeof CreateRuleSchema>): Promise<z.infer<typeof ScheduledJobRule>> {
        const now = new Date().toISOString();
        const _id = new ObjectId();

        const { scheduledTime, ...rest } = data;

        // convert date string to seconds since epoch
        // and round down to the last minute
        const nextRunAtDate = new Date(scheduledTime);
        const nextRunAtSeconds = Math.floor(nextRunAtDate.getTime() / 1000);
        const nextRunAtMinutes = Math.floor(nextRunAtSeconds / 60) * 60;
        const nextRunAt = nextRunAtMinutes;

        const doc: z.infer<typeof CreateDocSchema> = {
            ...rest,
            nextRunAt: nextRunAt,
            workerId: null,
            lastWorkerId: null,
            processedAt: null,
            jobId: undefined,
            createdAt: now,
            updatedAt: now,
            disabled: false,
        };

        await this.collection.insertOne({
            ...doc,
            _id,
        });

        return {
            ...doc,
            nextRunAt: new Date(nextRunAt * 1000).toISOString(),
            processedAt: null,
            id: _id.toString(),
        };
    }

    /**
     * Fetches a scheduled job rule by its unique identifier.
     */
    async fetch(id: string): Promise<z.infer<typeof ScheduledJobRule> | null> {
        const result = await this.collection.findOne({ _id: new ObjectId(id) });

        if (!result) {
            return null;
        }

        return this.convertDocToModel(result);
    }

    /**
     * Polls for the next available scheduled job rule that can be processed by a worker.
     * Returns a single rule that is ready to run, atomically locked for the worker.
     */
    async poll(workerId: string): Promise<z.infer<typeof ScheduledJobRule> | null> {
        const now = new Date();
        const notBefore = new Date(now.getTime() - 1000 * 60 * 3); // not older than 3 minutes
        
        // Use findOneAndUpdate to atomically find and lock the next available rule
        const result = await this.collection.findOneAndUpdate(
            {
                nextRunAt: { 
                    $lte: Math.floor(now.getTime() / 1000),
                    $gte: Math.floor(notBefore.getTime() / 1000),
                },
                processedAt: {
                    $or: [
                        { $eq: null },
                        { $lt: "$nextRunAt" },
                    ]
                },
                disabled: false,
                workerId: null,
            },
            {
                $set: {
                    workerId,
                    lastWorkerId: workerId,
                    updatedAt: now.toISOString(),
                },
            },
            {
                sort: { nextRunAt: 1 }, // Process earliest rules first
                returnDocument: "after",
            }
        );

        if (!result) {
            return null;
        }

        return this.convertDocToModel(result);
    }

    /**
     * Processes and releases a scheduled job rule after it has been executed.
     */
    async processAndRelease(id: string, jobId: string): Promise<z.infer<typeof ScheduledJobRule>> {
        const now = new Date();

        const result = await this.collection.findOneAndUpdate(
            {
                _id: new ObjectId(id),
            },
            {
                $set: {
                    processedAt: Math.floor(now.getTime() / 1000),
                    jobId,
                    workerId: null, // Release the lock
                    updatedAt: now.toISOString(),
                },
            },
            {
                returnDocument: "after",
            }
        );

        if (!result) {
            throw new NotFoundError(`Scheduled job rule ${id} not found`);
        }

        return this.convertDocToModel(result);
    }

    /**
     * Lists scheduled job rules for a specific project with pagination.
     */
    async list(projectId: string, cursor?: string, limit: number = 50): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ListedRuleItem>>>> {
        const query: any = { projectId };

        if (cursor) {
            query._id = { $lt: new ObjectId(cursor) };
        }

        const results = await this.collection
            .find(query)
            .sort({ _id: -1 })
            .limit(limit + 1) // Fetch one extra to determine if there's a next page
            .toArray();

        const hasNextPage = results.length > limit;
        const items = results.slice(0, limit).map(this.convertDocToModel);

        return {
            items,
            nextCursor: hasNextPage ? results[limit - 1]._id.toString() : null,
        };
    }

    /**
     * Disables a scheduled job rule by its unique identifier.
     */
    async disable(id: string): Promise<z.infer<typeof ScheduledJobRule>> {
        const result = await this.collection.findOneAndUpdate({
            _id: new ObjectId(id),
            disabled: false,
        }, {
            $set: {
                disabled: true,
                updatedAt: new Date().toISOString(),
            },
        }, {
            returnDocument: "after",
        });

        if (!result) {
            throw new NotFoundError(`Scheduled job rule ${id} not found`);
        }

        return this.convertDocToModel(result);
    }

    /**
     * Enables a scheduled job rule by its unique identifier.
     */
    async enable(id: string): Promise<z.infer<typeof ScheduledJobRule>> {
        const result = await this.collection.findOneAndUpdate({
            _id: new ObjectId(id),
            disabled: true,
        }, {
            $set: {
                disabled: false,
                updatedAt: new Date().toISOString(),
            },
        }, {
            returnDocument: "after",
        });

        if (!result) {
            throw new NotFoundError(`Scheduled job rule ${id} not found`);
        }

        return this.convertDocToModel(result);
    }
}
