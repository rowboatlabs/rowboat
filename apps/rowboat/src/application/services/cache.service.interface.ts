/**
 * Interface defining the contract for cache service implementations.
 * 
 * This interface provides methods for storing, retrieving, and deleting cached data
 * with support for time-to-live (TTL) expiration. Implementations can use various
 * caching backends such as Redis, in-memory storage, or other cache providers.
 */
export interface ICacheService {
    /**
     * Retrieves a value from the cache by its key.
     * 
     * @param key - The unique identifier for the cached item
     * @returns A promise that resolves to the cached value as a string, or null if the key doesn't exist or has expired
     */
    get(key: string): Promise<string | null>;

    /**
     * Stores a value in the cache with a specified time-to-live.
     * 
     * @param key - The unique identifier for the cached item
     * @param value - The value to cache (will be stored as a string)
     * @param ttl - Time-to-live in seconds. If not provided, the item will be cached indefinitely.
     * @returns A promise that resolves when the value has been successfully stored
     */
    set(key: string, value: string, ttl?: number): Promise<void>;

    /**
     * Removes a cached item by its key.
     * 
     * @param key - The unique identifier of the cached item to remove
     * @returns A promise that resolves to true if the item was successfully deleted, false if the key didn't exist
     */
    delete(key: string): Promise<boolean>;
}