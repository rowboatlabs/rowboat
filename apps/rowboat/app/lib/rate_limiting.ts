import { getRedisClient } from "./redis";

const MAX_QUERIES_PER_MINUTE = Number(process.env.MAX_QUERIES_PER_MINUTE) || 0;

export async function check_query_limit(projectId: string): Promise<boolean> {
    // if the limit is 0, we don't want to check the limit
    if (MAX_QUERIES_PER_MINUTE === 0) {
        return true;
    }

    const minutes_since_epoch = Math.floor(Date.now() / 1000 / 60); // 60 second window
    const key = `rate_limit:${projectId}:${minutes_since_epoch}`;

    // increment the counter and return the count
    try {
        const client = await getRedisClient();
        const count = await client.incr(key);
        if (count === 1) {
            await client.expire(key, 70); // Set TTL to clean up automatically
        }
        return count <= MAX_QUERIES_PER_MINUTE;
    } catch (error) {
        console.error("Redis operation failed in check_query_limit:", error);
        // If Redis fails, maybe allow the request? Or block it? 
        // Defaulting to allowing the request to avoid blocking users due to Redis issues.
        return true; 
    }
}