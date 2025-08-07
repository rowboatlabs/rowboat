import { z } from "zod";
import { db } from "@/app/lib/mongodb";
import { ObjectId } from "mongodb";
import { AddTurnData, CreateConversationData, IConversationsRepository, ListedConversationItem } from "@/src/application/repositories/conversations.repository.interface";
import { Conversation } from "@/src/entities/models/conversation";
import { nanoid } from "nanoid";
import { Turn } from "@/src/entities/models/turn";
import { PaginatedList } from "@/src/entities/common/paginated-list";

const DocSchema = Conversation
    .omit({
        id: true,
    });

export class MongoDBConversationsRepository implements IConversationsRepository {
    private readonly collection = db.collection<z.infer<typeof DocSchema>>("conversations");

    async create(data: z.infer<typeof CreateConversationData>): Promise<z.infer<typeof Conversation>> {
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

    async fetch(id: string): Promise<z.infer<typeof Conversation> | null> {
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

    async list(projectId: string, cursor?: string, limit: number = 50): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ListedConversationItem>>>> {
        const query: any = { projectId };

        if (cursor) {
            query._id = { $gt: new ObjectId(cursor) };
        }

        const results = await this.collection
            .find(query)
            .sort({ _id: 1 })
            .limit(limit + 1) // Fetch one extra to determine if there's a next page
            .project<z.infer<typeof ListedConversationItem> & { _id: ObjectId }>({
                _id: 1,
                projectId: 1,
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