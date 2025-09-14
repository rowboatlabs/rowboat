import { z } from "zod";
import { Filter, ObjectId } from "mongodb";
import { db } from "@/app/lib/mongodb";
import { CommunityAssistant, CommunityAssistantLike } from "@/src/entities/models/community-assistant";
import { PaginatedList } from "@/src/entities/common/paginated-list";
import { NotFoundError } from "@/src/entities/errors/common";

/**
 * MongoDB document schema for CommunityAssistant.
 * Excludes the 'id' field as it's represented by MongoDB's '_id'.
 */
const DocSchema = CommunityAssistant.omit({ id: true });

/**
 * MongoDB document schema for CommunityAssistantLike.
 */
const LikeDocSchema = CommunityAssistantLike.omit({ id: true });

/**
 * MongoDB implementation of the CommunityAssistants repository.
 */
export class MongoDBCommunityAssistantsRepository {
    private readonly collection = db.collection<z.infer<typeof DocSchema>>("community_assistants");
    private readonly likesCollection = db.collection<z.infer<typeof LikeDocSchema>>("community_assistant_likes");

    async create(data: Omit<z.infer<typeof CommunityAssistant>, 'id'>): Promise<z.infer<typeof CommunityAssistant>> {
        const now = new Date().toISOString();
        const _id = new ObjectId();

        const doc: z.infer<typeof DocSchema> = {
            ...data,
            publishedAt: now,
            lastUpdatedAt: now,
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

    async fetch(id: string): Promise<z.infer<typeof CommunityAssistant> | null> {
        const result = await this.collection.findOne({ _id: new ObjectId(id) });
        if (!result) return null;

        return {
            ...result,
            id: result._id.toString(),
        };
    }

    async list(filters: {
        category?: string;
        search?: string;
        featured?: boolean;
        isPublic?: boolean;
        authorId?: string;
    } = {}, cursor?: string, limit: number = 20): Promise<z.infer<ReturnType<typeof PaginatedList<typeof CommunityAssistant>>>> {
        const query: Filter<z.infer<typeof DocSchema>> = {};

        if (filters.category) {
            query.category = filters.category;
        }

        if (filters.featured !== undefined) {
            query.featured = filters.featured;
        }

        if (filters.isPublic !== undefined) {
            query.isPublic = filters.isPublic;
        }

        if (filters.authorId) {
            query.authorId = filters.authorId;
        }

        if (filters.search) {
            query.$or = [
                { name: { $regex: filters.search, $options: 'i' } },
                { description: { $regex: filters.search, $options: 'i' } },
                { tags: { $in: [new RegExp(filters.search, 'i')] } },
            ];
        }

        const skip = cursor ? parseInt(cursor) : 0;
        const results = await this.collection
            .find(query)
            .sort({ publishedAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const items = results.map(result => ({
            ...result,
            id: result._id.toString(),
        }));

        const nextCursor = results.length === limit ? (skip + limit).toString() : null;

        return {
            items,
            nextCursor,
        };
    }

    async update(id: string, data: Partial<Omit<z.infer<typeof CommunityAssistant>, 'id' | 'publishedAt'>>): Promise<z.infer<typeof CommunityAssistant> | null> {
        const now = new Date().toISOString();
        const updateData = {
            ...data,
            lastUpdatedAt: now,
        };

        const result = await this.collection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updateData },
            { returnDocument: 'after' }
        );

        if (!result) return null;

        return {
            ...result,
            id: result._id.toString(),
        };
    }

    async delete(id: string): Promise<boolean> {
        const result = await this.collection.deleteOne({ _id: new ObjectId(id) });
        return result.deletedCount > 0;
    }

    async incrementDownloadCount(id: string): Promise<void> {
        await this.collection.updateOne(
            { _id: new ObjectId(id) },
            { $inc: { downloadCount: 1 } }
        );
    }

    async toggleLike(assistantId: string, userId: string, userEmail?: string): Promise<{ liked: boolean; likeCount: number }> {
        const likeId = new ObjectId();
        const now = new Date().toISOString();

        // Check if user already liked this assistant
        const existingLike = await this.likesCollection.findOne({
            assistantId: assistantId,
            userId,
        });

        if (existingLike) {
            // Unlike: remove the like
            await this.likesCollection.deleteOne({ _id: existingLike._id });
            await this.collection.updateOne(
                { _id: new ObjectId(assistantId) },
                { 
                    $inc: { likeCount: -1 },
                    $pull: { likes: userId }
                }
            );
            return { liked: false, likeCount: await this.getLikeCount(assistantId) };
        } else {
            // Like: add the like
            await this.likesCollection.insertOne({
                _id: likeId,
                assistantId: assistantId,
                userId,
                userEmail,
                createdAt: now,
            });
            await this.collection.updateOne(
                { _id: new ObjectId(assistantId) },
                { 
                    $inc: { likeCount: 1 },
                    $addToSet: { likes: userId }
                }
            );
            return { liked: true, likeCount: await this.getLikeCount(assistantId) };
        }
    }

    async getLikeCount(assistantId: string): Promise<number> {
        const result = await this.collection.findOne(
            { _id: new ObjectId(assistantId) },
            { projection: { likeCount: 1 } }
        );
        return result?.likeCount || 0;
    }

    async getUserLikes(assistantId: string, userId: string): Promise<boolean> {
        const like = await this.likesCollection.findOne({
            assistantId: assistantId,
            userId,
        });
        return !!like;
    }

    async getCategories(): Promise<string[]> {
        const categories = await this.collection.distinct('category', { isPublic: true });
        return categories.filter(Boolean);
    }
}
