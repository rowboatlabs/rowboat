import { AddMessagesData, ITurnsRepository } from "@/src/application/repositories/turns.repository.interface";
import { Turn } from "@/src/entities/models/turn";
import { UpdateTurnData } from "@/src/application/repositories/turns.repository.interface";
import { CreateTurnData } from "@/src/application/repositories/turns.repository.interface";
import { z } from "zod";
import { db } from "@/app/lib/mongodb";
import { ObjectId } from "mongodb";

const DocSchema = Turn
    .omit({
        id: true,
        createdAt: true,
        lastUpdatedAt: true,
    })
    .extend({
        createdAt: z.string().datetime(),
        lastUpdatedAt: z.string().datetime().optional(),
        lockedByWorkerId: z.string().optional(),
        lockAcquiredAt: z.string().datetime().optional(),
        lockReleasedAt: z.string().datetime().optional(),
    });

export class TurnsRepositoryMongodb implements ITurnsRepository {
    private readonly collection = db.collection<z.infer<typeof DocSchema>>("turns");

    private transformDocToTurn(doc: z.infer<typeof DocSchema> & { _id: ObjectId }, id?: string): z.infer<typeof Turn> {
        const { _id, ...rest } = doc;
        return {
            ...rest,
            id: id || _id.toString(),
            createdAt: new Date(doc.createdAt),
            lastUpdatedAt: doc.lastUpdatedAt ? new Date(doc.lastUpdatedAt) : undefined,
        };
    }

    async createTurn(data: z.infer<typeof CreateTurnData>): Promise<z.infer<typeof Turn>> {
        const now = new Date();
        const _id = new ObjectId();

        const doc = {
            ...data,
            createdAt: now.toISOString(),
            status: "pending" as const,
        }

        await this.collection.insertOne({
            ...doc,
            _id,
        });

        return {
            ...data,
            ...doc,
            id: _id.toString(),
            createdAt: now,
        };
    }

    async getTurn(id: string): Promise<z.infer<typeof Turn> | null> {
        const result = await this.collection.findOne({
            _id: new ObjectId(id),
        });

        if (!result) {
            return null;
        }
        
        return this.transformDocToTurn(result, id);
    }

    async addMessages(id: string, data: z.infer<typeof AddMessagesData>): Promise<z.infer<typeof Turn>> {
        const result = await this.collection.findOneAndUpdate({
            _id: new ObjectId(id),
        }, {
            $push: { messages: { $each: data.messages } },
        }, {
            returnDocument: "after",
        });

        if (!result) {
            throw new Error("Turn not found");
        }

        return this.transformDocToTurn(result, id);
    }

    async saveTurn(id: string, data: z.infer<typeof UpdateTurnData>): Promise<z.infer<typeof Turn>> {
        const result = await this.collection.findOneAndUpdate({
            _id: new ObjectId(id),
        }, {
            $set: data,
        }, {
            returnDocument: "after",
        });

        if (!result) {
            throw new Error("Run not found");
        }

        return this.transformDocToTurn(result, id);
    }

    async pollTurns(workerId: string): Promise<z.infer<typeof Turn> | null> {
        const result = await this.collection.findOneAndUpdate({
            status: "pending",
            lockedByWorkerId: { $exists: false }
        }, {
            $set: {
                lockedByWorkerId: workerId,
                lockAcquiredAt: new Date().toISOString(),
                status: "running" as const,
            },
        }, {
            returnDocument: "after",
        });

        if (!result) {
            return null;
        }

        return this.transformDocToTurn(result);
    }

    async lockTurn(runId: string, workerId: string): Promise<z.infer<typeof Turn> | null> {
        const result = await this.collection.findOneAndUpdate({
            _id: new ObjectId(runId),
            status: "pending",
            lockedByWorkerId: { $exists: false },
        }, {
            $set: {
                lockedByWorkerId: workerId,
                lockAcquiredAt: new Date().toISOString(),
                status: "running" as const,
            },
        }, {
            returnDocument: "after",
        });

        if (!result) {
            return null;
        }

        return this.transformDocToTurn(result);
    }

    async releaseTurn(runId: string): Promise<boolean> {
        const result = await this.collection.updateOne({
            _id: new ObjectId(runId),
            lockedByWorkerId: { $exists: true },
        }, {
            $set: {
                lockedByWorkerId: undefined,
                lockAcquiredAt: undefined,
                status: "pending" as const,
            },
        });

        return result.modifiedCount > 0;
    }

    async getConversationTurns(conversationId: string): Promise<z.infer<typeof Turn>[]> {
        const result = await this.collection.find({
            conversationId,
        }).toArray();

        return result.map(doc => this.transformDocToTurn(doc));
    }
}