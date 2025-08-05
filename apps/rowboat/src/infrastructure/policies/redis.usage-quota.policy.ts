import { IUsageQuotaPolicy } from "@/src/application/policies/usage-quota.policy.interface";
import { redisClient } from "@/app/lib/redis";
import { QuotaExceededError } from "@/src/entities/errors/common";

const MAX_QUERIES_PER_MINUTE = Number(process.env.MAX_QUERIES_PER_MINUTE) || 0;

export class RedisUsageQuotaPolicy implements IUsageQuotaPolicy {
    async assertAndConsume(projectId: string): Promise<void> {
        if (MAX_QUERIES_PER_MINUTE === 0) {
            return;
        }

        const minutes_since_epoch = Math.floor(Date.now() / 1000 / 60); // 60 second window
        const key = `rate_limit:${projectId}:${minutes_since_epoch}`;

        const count = await redisClient.incr(key);
        if (count === 1) {
            await redisClient.expire(key, 70); // Set TTL to clean up automatically
        }

        if (count > MAX_QUERIES_PER_MINUTE) {
            throw new QuotaExceededError(`Quota exceeded for project ${projectId}`);
        }
    }
}