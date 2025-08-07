/**
 * Represents a subscription to a pub-sub channel.
 * 
 * This interface provides a way to manage subscriptions to pub-sub channels,
 * allowing subscribers to unsubscribe from channels when they no longer need
 * to receive messages.
 */
export interface Subscription {
    /**
     * Unsubscribes from the associated pub-sub channel.
     * 
     * This method should be called when the subscriber no longer wants to
     * receive messages from the channel. After calling this method, the
     * handler function will no longer be invoked for new messages on the channel.
     * 
     * @returns A promise that resolves when the unsubscribe operation is complete
     * @throws {Error} If the unsubscribe operation fails
     * 
     * @example
     * ```typescript
     * const subscription = await pubSubService.subscribe('user-events', (message) => {
     *   console.log('Received message:', message);
     * });
     * 
     * // Later, when you want to stop receiving messages
     * await subscription.unsubscribe();
     * ```
     */
    unsubscribe(): Promise<void>;
}

/**
 * Interface for a publish-subscribe (pub-sub) service.
 * 
 * This interface defines the contract for a pub-sub service that allows
 * publishing messages to channels and subscribing to receive messages from
 * those channels. It provides a decoupled communication pattern where
 * publishers and subscribers don't need to know about each other directly.
 * 
 * The service supports:
 * - Publishing messages to specific channels
 * - Subscribing to channels to receive messages
 * - Managing subscriptions with the ability to unsubscribe
 * 
 * @example
 * ```typescript
 * // Publishing a message
 * await pubSubService.publish('user-events', JSON.stringify({
 *   userId: '123',
 *   action: 'login',
 *   timestamp: new Date().toISOString()
 * }));
 * 
 * // Subscribing to receive messages
 * const subscription = await pubSubService.subscribe('user-events', (message) => {
 *   const event = JSON.parse(message);
 *   console.log(`User ${event.userId} performed ${event.action}`);
 * });
 * 
 * // Unsubscribing when done
 * await subscription.unsubscribe();
 * ```
 */
export interface IPubSubService {
    /**
     * Publishes a message to a specific channel.
     * 
     * This method sends a message to all subscribers of the specified channel.
     * The message is delivered asynchronously to all active subscribers.
     * 
     * @param channel - The channel name to publish the message to
     * @param message - The message content to publish (typically a JSON string)
     * @returns A promise that resolves when the message has been published
     * @throws {Error} If the publish operation fails (e.g., network error, invalid channel)
     * 
     * @example
     * ```typescript
     * await pubSubService.publish('notifications', JSON.stringify({
     *   type: 'alert',
     *   message: 'System maintenance scheduled',
     *   priority: 'high'
     * }));
     * ```
     */
    publish(channel: string, message: string): Promise<void>;

    /**
     * Subscribes to a channel to receive messages.
     * 
     * This method creates a subscription to the specified channel. When a message
     * is published to the channel, the provided handler function will be invoked
     * with the message content.
     * 
     * The subscription remains active until the returned subscription object's
     * `unsubscribe()` method is called.
     * 
     * @param channel - The channel name to subscribe to
     * @param handler - A function that will be called when messages are received on the channel.
     *                  The function receives the message content as a string parameter.
     * @returns A promise that resolves to a Subscription object that can be used to unsubscribe
     * @throws {Error} If the subscribe operation fails (e.g., network error, invalid channel)
     * 
     * @example
     * ```typescript
     * const subscription = await pubSubService.subscribe('chat-room-123', (message) => {
     *   const chatMessage = JSON.parse(message);
     *   console.log(`${chatMessage.user}: ${chatMessage.text}`);
     * });
     * 
     * // Store the subscription for later cleanup
     * this.subscriptions.push(subscription);
     * ```
     */
    subscribe(channel: string, handler: (message: string) => void): Promise<Subscription>;
}