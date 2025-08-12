import { z } from "zod";
import { ObjectId } from "mongodb";
import { db } from "@/app/lib/mongodb";
import { CreateRecurringRuleSchema, IRecurringJobRulesRepository, ListedRecurringRuleItem, UpdateRecurringRuleSchema } from "@/src/application/repositories/recurring-job-rules.repository.interface";
import { RecurringJobRule } from "@/src/entities/models/recurring-job-rule";
import { NotFoundError } from "@/src/entities/errors/common";
import { PaginatedList } from "@/src/entities/common/paginated-list";

// Simple cron parser for minute-level resolution
function parseCronExpression(cron: string): Date {
    const parts = cron.split(' ');
    if (parts.length !== 5) {
        throw new Error('Invalid cron expression. Expected 5 parts: minute hour day month dayOfWeek');
    }
    
    const [minute, hour, day, month, dayOfWeek] = parts;
    
    // For now, we'll use a simple approach that calculates the next run time
    // In a production environment, you'd want to use a proper cron library
    const now = new Date();
    const nextRun = new Date(now);
    
    // Set to next minute if current minute doesn't match
    if (minute !== '*' && minute !== now.getMinutes().toString()) {
        nextRun.setMinutes(now.getMinutes() + 1);
        nextRun.setSeconds(0);
        nextRun.setMilliseconds(0);
    } else {
        nextRun.setSeconds(0);
        nextRun.setMilliseconds(0);
    }
    
    return nextRun;
}

/**
 * MongoDB document schema for RecurringJobRule.
 * Excludes the 'id' field as it's represented by MongoDB's '_id'.
 */
const DocSchema = RecurringJobRule
    .omit({
        id: true,
        nextRunAt: true,
        lastProcessedAt: true,
    })
    .extend({
        _id: z.instanceof(ObjectId),
        nextRunAt: z.number(),
        lastProcessedAt: z.number().optional(),
    });

/**
 * Schema for creating documents (without _id field).
 */
const CreateDocSchema = DocSchema.omit({ _id: true });

/**
 * MongoDB implementation of the RecurringJobRulesRepository.
 * 
 * This repository manages recurring job rules in MongoDB, providing operations for
 * creating, fetching, polling, processing, and listing rules for worker processing.
 */
export class MongoDBRecurringJobRulesRepository implements IRecurringJobRulesRepository {
    private readonly collection = db.collection<z.infer<typeof DocSchema>>("recurring_job_rules");

    /**
     * Converts a MongoDB document to a domain model.
     * Handles the conversion of timestamps from Unix timestamps to ISO strings.
     */
    private convertDocToModel(doc: z.infer<typeof DocSchema>): z.infer<typeof RecurringJobRule> {
        const { _id, nextRunAt, lastProcessedAt, ...rest } = doc;
        return {
            ...rest,
            id: _id.toString(),
            nextRunAt: new Date(nextRunAt * 1000).toISOString(),
            lastProcessedAt: lastProcessedAt ? new Date(lastProcessedAt * 1000).toISOString() : undefined,
        };
    }

    /**
     * Creates a new recurring job rule in the system.
     */
    async create(data: z.infer<typeof CreateRecurringRuleSchema>): Promise<z.infer<typeof RecurringJobRule>> {
        const now = new Date().toISOString();
        const _id = new ObjectId();

        // Calculate the first nextRunAt based on cron expression
        const firstNextRunAt = parseCronExpression(data.cron);
        const nextRunAtSeconds = Math.floor(firstNextRunAt.getTime() / 1000);

        const doc: z.infer<typeof CreateDocSchema> = {
            ...data,
            nextRunAt: nextRunAtSeconds,
            disabled: false,
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
            nextRunAt: new Date(nextRunAtSeconds * 1000).toISOString(),
            id: _id.toString(),
        };
    }

    /**
     * Fetches a recurring job rule by its unique identifier.
     */
    async fetch(id: string): Promise<z.infer<typeof RecurringJobRule> | null> {
        const result = await this.collection.findOne({ _id: new ObjectId(id) });

        if (!result) {
            return null;
        }

        return this.convertDocToModel(result);
    }

    /**
     * Polls for the next available recurring job rule that can be processed by a worker.
     * Returns a single rule that is ready to run, atomically locked for the worker.
     */
    async poll(workerId: string): Promise<z.infer<typeof RecurringJobRule> | null> {
        const now = new Date();
        const notBefore = new Date(now.getTime() - 1000 * 60 * 3); // not older than 3 minutes
        
        // Use findOneAndUpdate to atomically find and lock the next available rule
        const result = await this.collection.findOneAndUpdate(
            {
                nextRunAt: { 
                    $lte: Math.floor(now.getTime() / 1000),
                    $gte: Math.floor(notBefore.getTime() / 1000),
                },
                disabled: false,
                workerId: null,
            },
            {
                $set: {
                    workerId,
                    lastWorkerId: workerId,
                    lastProcessedAt: Math.floor(now.getTime() / 1000),
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
     * Updates a recurring job rule with new data.
     */
    async update(id: string, data: z.infer<typeof UpdateRecurringRuleSchema>): Promise<z.infer<typeof RecurringJobRule>> {
        const now = new Date();
        const result = await this.collection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: { ...data, updatedAt: now.toISOString() } },
        );

        if (!result) {
            throw new NotFoundError(`Recurring job rule ${id} not found`);
        }

        return this.convertDocToModel(result);
    }

    /**
     * Releases a recurring job rule after it has been executed and sets the next run time.
     */
    async release(id: string, nextRunAt: string): Promise<z.infer<typeof RecurringJobRule>> {
        const now = new Date();
        const nextRunAtSeconds = Math.floor(new Date(nextRunAt).getTime() / 1000);

        const result = await this.collection.findOneAndUpdate(
            {
                _id: new ObjectId(id),
            },
            {
                $set: {
                    workerId: null, // Release the lock
                    nextRunAt: nextRunAtSeconds,
                    updatedAt: now.toISOString(),
                },
            },
            {
                returnDocument: "after",
            }
        );

        if (!result) {
            throw new NotFoundError(`Recurring job rule ${id} not found`);
        }

        return this.convertDocToModel(result);
    }

    /**
     * Lists recurring job rules for a specific project with pagination.
     */
    async list(projectId: string, cursor?: string, limit: number = 50): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ListedRecurringRuleItem>>>> {
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
}
