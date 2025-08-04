import { z } from "zod";
import { db } from "@/app/lib/mongodb";
import { ObjectId } from "mongodb";
import { AddTurnData, CreateConversationData, IConversationsRepository } from "@/src/application/repositories/conversations.repository.interface";
import { Conversation } from "@/src/entities/models/conversation";
import { nanoid } from "nanoid";
import { Turn } from "@/src/entities/models/turn";

const DocSchema = Conversation
    .omit({
        id: true,
    });

export class MongoDBConversationsRepository implements IConversationsRepository {
    private readonly collection = db.collection<z.infer<typeof DocSchema>>("conversations");

    async createConversation(data: z.infer<typeof CreateConversationData>): Promise<z.infer<typeof Conversation>> {
        const now = new Date();
        const _id = new ObjectId();

        const doc = {
            ...data,
            createdAt: now.toISOString(),
        }

        await this.collection.insertOne({
            ...doc,
            _id,
        });

        return {
            ...data,
            ...doc,
            id: _id.toString(),
        };
    }

    async getConversation(id: string): Promise<z.infer<typeof Conversation> | null> {
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
        };
    }

    async addTurn(conversationId: string, data: z.infer<typeof AddTurnData>): Promise<z.infer<typeof Turn>> {
        // create turn object from data
        const turn: z.infer<typeof Turn> = {
            ...data,
            id: nanoid(),
            createdAt: new Date().toISOString(),
        };

        await this.collection.updateOne({
            _id: new ObjectId(conversationId),
        }, {
            $push: {
                turns: turn,
            },
            $set: {
                updatedAt: new Date().toISOString(),
            },
        });

        return turn;
    }
}