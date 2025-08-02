import { IPubSubService, ISubscription } from "@/src/application/services/pubsub.service.interface";
import { redisClient } from "@/app/lib/redis";
import { Redis } from "ioredis";

export class RedisSubscription implements ISubscription {
    constructor(private readonly subscriber: Redis, private readonly topic: string) {}

    async unsubscribe(): Promise<void> {
        this.subscriber.unsubscribe(this.topic);
    }
}

export class RedisPubSubService implements IPubSubService {
    async publish(topic: string, message: string): Promise<void> {
        await redisClient.publish(topic, message);
    }

    async subscribe(topic: string, handler: (message: string) => void): Promise<ISubscription> {
        const subscriber = redisClient.duplicate();
        await subscriber.subscribe(topic);

        subscriber.on('message', (channel, message) => {
            if (channel === topic) {
                handler(message);
            }
        });

        return new RedisSubscription(subscriber, topic);
    }
}