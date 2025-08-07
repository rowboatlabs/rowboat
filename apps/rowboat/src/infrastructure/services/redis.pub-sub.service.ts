import { IPubSubService, Subscription } from "@/src/application/services/pub-sub.service.interface";
import { redisClient } from "@/app/lib/redis";
import Redis from 'ioredis';

/**
 * Redis implementation of the pub-sub service interface.
 * 
 * This service uses Redis pub-sub functionality to provide a distributed
 * messaging system where publishers can send messages to channels and
 * subscribers can receive messages from those channels.
 * 
 * Features:
 * - Distributed messaging across multiple application instances
 * - Automatic message delivery to all subscribers
 * - Support for multiple channels
 * - Asynchronous message handling
 */
export class RedisPubSubService implements IPubSubService {
    private subscriptions = new Map<string, Set<(message: string) => void>>();
    private redisSubscriber: Redis | null = null;

    constructor() {
        this.setupRedisSubscriber();
    }

    /**
     * Sets up the Redis subscriber connection for receiving messages.
     * This creates a separate Redis connection specifically for subscriptions
     * to avoid blocking the main Redis client.
     */
    private setupRedisSubscriber(): void {
        this.redisSubscriber = new Redis(process.env.REDIS_URL || '');
        
        this.redisSubscriber.on('message', (channel: string, message: string) => {
            const handlers = this.subscriptions.get(channel);
            if (handlers) {
                handlers.forEach(handler => {
                    try {
                        handler(message);
                    } catch (error) {
                        console.error(`Error in pub-sub handler for channel ${channel}:`, error);
                    }
                });
            }
        });

        this.redisSubscriber.on('error', (error: Error) => {
            console.error('Redis pub-sub subscriber error:', error);
        });
    }

    /**
     * Publishes a message to a specific channel.
     * 
     * @param channel - The channel name to publish the message to
     * @param message - The message content to publish
     * @returns A promise that resolves when the message has been published
     * @throws {Error} If the publish operation fails
     */
    async publish(channel: string, message: string): Promise<void> {
        try {
            await redisClient.publish(channel, message);
        } catch (error) {
            console.error(`Failed to publish message to channel ${channel}:`, error);
            throw new Error(`Failed to publish message to channel ${channel}: ${error}`);
        }
    }

    /**
     * Subscribes to a channel to receive messages.
     * 
     * @param channel - The channel name to subscribe to
     * @param handler - A function that will be called when messages are received
     * @returns A promise that resolves to a Subscription object
     * @throws {Error} If the subscribe operation fails
     */
    async subscribe(channel: string, handler: (message: string) => void): Promise<Subscription> {
        try {
            // Add handler to local subscriptions map
            if (!this.subscriptions.has(channel)) {
                this.subscriptions.set(channel, new Set());
            }
            this.subscriptions.get(channel)!.add(handler);

            // Subscribe to the channel in Redis if this is the first handler
            if (this.subscriptions.get(channel)!.size === 1 && this.redisSubscriber) {
                await this.redisSubscriber.subscribe(channel);
            }

            // Return subscription object for cleanup
            return {
                unsubscribe: async (): Promise<void> => {
                    await this.unsubscribe(channel, handler);
                }
            };
        } catch (error) {
            console.error(`Failed to subscribe to channel ${channel}:`, error);
            throw new Error(`Failed to subscribe to channel ${channel}: ${error}`);
        }
    }

    /**
     * Unsubscribes a specific handler from a channel.
     * 
     * @param channel - The channel name to unsubscribe from
     * @param handler - The handler function to remove
     */
    private async unsubscribe(channel: string, handler: (message: string) => void): Promise<void> {
        try {
            const handlers = this.subscriptions.get(channel);
            if (handlers) {
                handlers.delete(handler);
                
                // If no more handlers for this channel, unsubscribe from Redis
                if (handlers.size === 0) {
                    this.subscriptions.delete(channel);
                    if (this.redisSubscriber) {
                        await this.redisSubscriber.unsubscribe(channel);
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to unsubscribe from channel ${channel}:`, error);
            throw new Error(`Failed to unsubscribe from channel ${channel}: ${error}`);
        }
    }
}
