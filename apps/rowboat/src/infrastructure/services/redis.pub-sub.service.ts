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
            // Create a new Redis subscriber for this subscription
            const subscriber = redisClient.duplicate();
            
            // Set up the message handler
            subscriber.on('message', (receivedChannel: string, message: string) => {
                if (receivedChannel === channel) {
                    try {
                        handler(message);
                    } catch (error) {
                        console.error(`Error in pub-sub handler for channel ${channel}:`, error);
                    }
                }
            });

            // Subscribe to the channel
            await subscriber.subscribe(channel);

            // Return subscription object that handles cleanup
            return {
                unsubscribe: async (): Promise<void> => {
                    try {
                        await subscriber.unsubscribe(channel);
                        await subscriber.quit();
                    } catch (error) {
                        console.error(`Failed to unsubscribe from channel ${channel}:`, error);
                        throw new Error(`Failed to unsubscribe from channel ${channel}: ${error}`);
                    }
                }
            };
        } catch (error) {
            console.error(`Failed to subscribe to channel ${channel}:`, error);
            throw new Error(`Failed to subscribe to channel ${channel}: ${error}`);
        }
    }
}
