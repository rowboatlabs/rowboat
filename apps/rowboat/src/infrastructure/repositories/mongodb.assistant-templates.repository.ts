import { z } from "zod";
import { Filter, ObjectId } from "mongodb";
import { db } from "@/app/lib/mongodb";
import { AssistantTemplate, AssistantTemplateLike } from "@/src/entities/models/assistant-template";
import { PaginatedList } from "@/src/entities/common/paginated-list";

const DocSchema = AssistantTemplate.omit({ id: true });
const LikeDocSchema = AssistantTemplateLike.omit({ id: true });

export class MongoDBAssistantTemplatesRepository {
    private readonly collection = db.collection<z.infer<typeof DocSchema>>("assistant_templates");
    private readonly likesCollection = db.collection<z.infer<typeof LikeDocSchema>>("assistant_template_likes");

    async create(data: Omit<z.infer<typeof AssistantTemplate>, 'id' | 'publishedAt' | 'lastUpdatedAt'>): Promise<z.infer<typeof AssistantTemplate>> {
        const now = new Date().toISOString();
        const _id = new ObjectId();
        const doc: z.infer<typeof DocSchema> = { ...data, publishedAt: now, lastUpdatedAt: now } as any;
        await this.collection.insertOne({ ...doc, _id });
        return { ...doc, id: _id.toString() } as any;
    }

    async fetch(id: string): Promise<z.infer<typeof AssistantTemplate> | null> {
        const result = await this.collection.findOne({ _id: new ObjectId(id) });
        if (!result) return null;
        return { ...result, id: result._id.toString() } as any;
    }

    async list(filters: {
        category?: string;
        search?: string;
        featured?: boolean;
        isPublic?: boolean;
        authorId?: string;
        source?: 'library' | 'community';
    } = {}, cursor?: string, limit: number = 20): Promise<z.infer<ReturnType<typeof PaginatedList<typeof AssistantTemplate>>>> {
        const query: Filter<z.infer<typeof DocSchema>> = {};
        if (filters.category) query.category = filters.category;
        if (filters.featured !== undefined) query.featured = filters.featured;
        if (filters.isPublic !== undefined) query.isPublic = filters.isPublic;
        if (filters.authorId) query.authorId = filters.authorId;
        if (filters.source) query.source = filters.source;
        if (filters.search) {
            query.$or = [
                { name: { $regex: filters.search, $options: 'i' } },
                { description: { $regex: filters.search, $options: 'i' } },
                { tags: { $in: [new RegExp(filters.search, 'i')] } },
            ];
        }

        const skip = cursor ? parseInt(cursor) : 0;
        const results = await this.collection.find(query).sort({ publishedAt: -1 }).skip(skip).limit(limit).toArray();
        const items = results.map(r => ({ ...r, id: r._id.toString() }));
        const nextCursor = results.length === limit ? (skip + limit).toString() : null;
        return { items, nextCursor } as any;
    }

    async toggleLike(assistantId: string, userId: string, userEmail?: string): Promise<{ liked: boolean; likeCount: number }> {
        const existingLike = await this.likesCollection.findOne({ assistantId, userId });
        if (existingLike) {
            await this.likesCollection.deleteOne({ _id: existingLike._id });
            await this.collection.updateOne({ _id: new ObjectId(assistantId) }, { $inc: { likeCount: -1 }, $pull: { likes: userId } });
            return { liked: false, likeCount: await this.getLikeCount(assistantId) };
        } else {
            const now = new Date().toISOString();
            await this.likesCollection.insertOne({ assistantId, userId, userEmail, createdAt: now } as any);
            await this.collection.updateOne({ _id: new ObjectId(assistantId) }, { $inc: { likeCount: 1 }, $addToSet: { likes: userId } });
            return { liked: true, likeCount: await this.getLikeCount(assistantId) };
        }
    }

    async getLikeCount(assistantId: string): Promise<number> {
        const result = await this.collection.findOne({ _id: new ObjectId(assistantId) }, { projection: { likeCount: 1 } });
        return result?.likeCount || 0;
    }

    async getCategories(): Promise<string[]> {
        const categories = await this.collection.distinct('category', { isPublic: true });
        return categories.filter(Boolean);
    }
}


