import { redisClient } from "./redis";

const MAX_QUERIES_PER_MINUTE = Number(process.env.MAX_QUERIES_PER_MINUTE) || 0;

export async function check_query_limit(projectId: string): Promise<boolean> {
    // if the limit is 0, we don't want to check the limit
    if (MAX_QUERIES_PER_MINUTE === 0) {
        return true;
    }

    const minutes_since_epoch = Math.floor(Date.now() / 1000 / 60); // 60 second window
    const key = `rate_limit:${projectId}:${minutes_since_epoch}`;

    // increment the counter and return the count
    const count = await redisClient.incr(key);
    if (count === 1) {
        await redisClient.expire(key, 70); // Set TTL to clean up automatically
    }

    return count <= MAX_QUERIES_PER_MINUTE;
}