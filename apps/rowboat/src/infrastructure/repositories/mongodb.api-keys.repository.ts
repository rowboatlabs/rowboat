import { IApiKeysRepository } from "@/src/application/repositories/api-keys.repository.interface";
import { apiKeysCollection } from "@/app/lib/mongodb";

export class MongoDBApiKeysRepository implements IApiKeysRepository {
    async checkAndConsumeKey(projectId: string, apiKey: string): Promise<boolean> {
        const result = await apiKeysCollection.findOneAndUpdate(
            { projectId, key: apiKey },
            { $set: { lastUsedAt: new Date().toISOString() } }
        );
        return !!result;
    }
}