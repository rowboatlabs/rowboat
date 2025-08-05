import { ICacheService } from "@/src/application/services/cache.service.interface";
import { redisClient } from "@/app/lib/redis";

export class RedisCacheService implements ICacheService {
    async get(key: string): Promise<string | null> {
        return await redisClient.get(key);
    }

    async set(key: string, value: string, ttl?: number): Promise<void> {
        if (ttl) {
            await redisClient.set(key, value, 'EX', ttl);
        } else {
            await redisClient.set(key, value);
        }
    }

    async delete(key: string): Promise<boolean> {
        return await redisClient.del(key) > 0;
    }
}