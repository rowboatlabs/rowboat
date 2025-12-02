import z from "zod";
import { IMonotonicallyIncreasingIdGenerator } from "./id-gen.js";

const EnqueuedMessage = z.object({
    messageId: z.string(),
    message: z.string(),
});

export interface IMessageQueue {
    enqueue(runId: string, message: string): Promise<string>;
    dequeue(runId: string): Promise<z.infer<typeof EnqueuedMessage> | null>;
}

export class InMemoryMessageQueue implements IMessageQueue {
    private store: Record<string, z.infer<typeof EnqueuedMessage>[]> = {};
    private idGenerator: IMonotonicallyIncreasingIdGenerator;

    constructor({
        idGenerator,
    }: {
        idGenerator: IMonotonicallyIncreasingIdGenerator;
    }) {
        this.idGenerator = idGenerator;
    }

    async enqueue(runId: string, message: string): Promise<string> {
        if (!this.store[runId]) {
            this.store[runId] = [];
        }
        const id = await this.idGenerator.next();
        this.store[runId].push({
            messageId: id,
            message,
        });
        return id;
    }

    async dequeue(runId: string): Promise<z.infer<typeof EnqueuedMessage> | null> {
        if (!this.store[runId]) {
            return null;
        }
        return this.store[runId].shift() ?? null;
    }
}