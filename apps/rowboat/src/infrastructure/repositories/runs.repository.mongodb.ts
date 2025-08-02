import { ITurnsRepository } from "@/src/application/repositories/turns.repository.interface";
import { Turn, UpdateTurnData } from "@/src/entities/models/turn";
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

export class TurnsRepository implements ITurnsRepository {
    private readonly collection = db.collection<z.infer<typeof DocSchema>>("turns");

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
        
        const { _id, ...rest } = result;

        return {
            ...rest,
            id,
            createdAt: new Date(result.createdAt),
            lastUpdatedAt: result.lastUpdatedAt ? new Date(result.lastUpdatedAt) : undefined,
        };
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

        const { _id, ...rest } = result;

        return {
            ...rest,
            id,
            createdAt: new Date(result.createdAt),
            lastUpdatedAt: result.lastUpdatedAt ? new Date(result.lastUpdatedAt) : undefined,
        };
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

        const { _id, ...rest } = result;

        return {
            ...rest,
            id: _id.toString(),
            createdAt: new Date(result.createdAt),
            lastUpdatedAt: result.lastUpdatedAt ? new Date(result.lastUpdatedAt) : undefined,
        };
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

        const { _id, ...rest } = result;

        return {
            ...rest,
            id: _id.toString(),
            createdAt: new Date(result.createdAt),
            lastUpdatedAt: result.lastUpdatedAt ? new Date(result.lastUpdatedAt) : undefined,
        };
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
}