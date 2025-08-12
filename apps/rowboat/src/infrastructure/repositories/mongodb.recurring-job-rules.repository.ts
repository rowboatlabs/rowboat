import { z } from "zod";
import { ObjectId } from "mongodb";
import { db } from "@/app/lib/mongodb";
import { CreateRecurringRuleSchema, IRecurringJobRulesRepository, ListedRecurringRuleItem } from "@/src/application/repositories/recurring-job-rules.repository.interface";
import { RecurringJobRule } from "@/src/entities/models/recurring-job-rule";
import { NotFoundError } from "@/src/entities/errors/common";
import { PaginatedList } from "@/src/entities/common/paginated-list";
import { CronExpressionParser } from 'cron-parser';

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

        const doc: z.infer<typeof CreateDocSchema> = {
            ...data,
            nextRunAt: 0,
            disabled: false,
            workerId: null,
            lastWorkerId: null,
            createdAt: now,
        };

        await this.collection.insertOne({
            ...doc,
            _id,
        });

        // update next run and return
        return await this.updateNextRunAt(_id.toString(), data.cron);
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
                $or: [
                    {
                        lastProcessedAt: {
                            $lt: Math.floor(now.getTime() / 1000),
                        },
                    },
                    { lastProcessedAt: { $exists: false } },
                ],
                disabled: false,
                workerId: null,
            },
            {
                $set: {
                    workerId,
                    lastWorkerId: workerId,
                    lastProcessedAt: Math.floor(now.getTime() / 1000),
                    lastError: undefined,
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
     * Releases a recurring job rule after it has been executed
     */
    async release(id: string): Promise<z.infer<typeof RecurringJobRule>> {
        const now = new Date();

        const result = await this.collection.findOneAndUpdate(
            {
                _id: new ObjectId(id),
            },
            {
                $set: {
                    workerId: null, // Release the lock
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

        // update next run at
        return await this.updateNextRunAt(id, result.cron);
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

    /**
     * Toggles a recurring job rule's disabled state
     */
    async toggle(id: string, disabled: boolean): Promise<z.infer<typeof RecurringJobRule>> {
        const result = await this.collection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: { disabled, updatedAt: new Date().toISOString() } },
        );

        if (!result) {
            throw new NotFoundError(`Recurring job rule ${id} not found`);
        }

        // update next run and return
        return await this.updateNextRunAt(id, result.cron);
    }

    /**
     * Deletes a recurring job rule by its unique identifier.
     */
    async delete(id: string): Promise<boolean> {
        const result = await this.collection.deleteOne({
            _id: new ObjectId(id),
        });

        return result.deletedCount > 0;
    }

    async updateNextRunAt(id: string, cron: string): Promise<z.infer<typeof RecurringJobRule>> {
        // parse cron to get next run time
        const interval = CronExpressionParser.parse(cron, {
            tz: "UTC",
        });
        const nextRunAt = Math.floor(interval.next().toDate().getTime() / 1000);

        const result = await this.collection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: { nextRunAt, updatedAt: new Date().toISOString() } },
            { returnDocument: "after" },
        );

        if (!result) {
            throw new NotFoundError(`Recurring job rule ${id} not found`);
        }

        return this.convertDocToModel(result);
    }
}
