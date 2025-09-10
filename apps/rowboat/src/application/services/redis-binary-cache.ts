import { redisClient } from '@/app/lib/redis';
import crypto from 'crypto';

export const redisBinaryCache = {
  async put(buf: Buffer, mimeType: string, ttlSec: number = 600): Promise<string> {
    const id = crypto.randomUUID();
    const dataKey = `tmpimg:data:${id}`;
    const mimeKey = `tmpimg:mime:${id}`;
    // Store bytes and mime with TTL
    await redisClient.set(dataKey, buf, 'EX', ttlSec);
    await redisClient.set(mimeKey, mimeType, 'EX', ttlSec);
    return id;
  },
  async get(id: string): Promise<{ buf: Buffer; mimeType: string } | null> {
    const dataKey = `tmpimg:data:${id}`;
    const mimeKey = `tmpimg:mime:${id}`;
    const [buf, mimeType] = await Promise.all([
      // ioredis getBuffer returns a Buffer
      (redisClient as any).getBuffer(dataKey) as Promise<Buffer | null>,
      redisClient.get(mimeKey) as Promise<string | null>,
    ]);
    if (!buf || !mimeType) return null;
    return { buf, mimeType };
  }
};

