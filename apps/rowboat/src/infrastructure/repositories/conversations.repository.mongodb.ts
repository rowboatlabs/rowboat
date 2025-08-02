import { z } from "zod";
import { db } from "@/app/lib/mongodb";
import { ObjectId } from "mongodb";
import { CreateConversationData, IConversationsRepository } from "@/src/application/repositories/conversations.repository.interface";
import { Conversation } from "@/src/entities/models/conversation";

const DocSchema = Conversation
    .omit({
        id: true,
        createdAt: true,
    })
    .extend({
        createdAt: z.string().datetime(),
    });

export class ConversationsRepositoryMongodb implements IConversationsRepository {
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
            createdAt: now,
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
            createdAt: new Date(result.createdAt),
        };
    }
}