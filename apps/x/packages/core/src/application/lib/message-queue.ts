import { IMonotonicallyIncreasingIdGenerator } from "./id-gen.js";
import { UserMessageContent } from "@x/shared/dist/message.js";
import z from "zod";

export type UserMessageContentType = z.infer<typeof UserMessageContent>;

type EnqueuedMessage = {
    messageId: string;
    message: UserMessageContentType;
};

export interface IMessageQueue {
    enqueue(runId: string, message: UserMessageContentType): Promise<string>;
    dequeue(runId: string): Promise<EnqueuedMessage | null>;
}

export class InMemoryMessageQueue implements IMessageQueue {
    private store: Record<string, EnqueuedMessage[]> = {};
    private idGenerator: IMonotonicallyIncreasingIdGenerator;

    constructor({
        idGenerator,
    }: {
        idGenerator: IMonotonicallyIncreasingIdGenerator;
    }) {
        this.idGenerator = idGenerator;
    }

    async enqueue(runId: string, message: UserMessageContentType): Promise<string> {
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

    async dequeue(runId: string): Promise<EnqueuedMessage | null> {
        if (!this.store[runId]) {
            return null;
        }
        return this.store[runId].shift() ?? null;
    }
}