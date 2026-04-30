import { IMonotonicallyIncreasingIdGenerator } from "./id-gen.js";
import { UserMessageContent } from "@x/shared/dist/message.js";
import z from "zod";

export type UserMessageContentType = z.infer<typeof UserMessageContent>;
export type VoiceOutputMode = 'summary' | 'full';
export type MiddlePaneContext =
    | { kind: 'note'; path: string; content: string }
    | { kind: 'browser'; url: string; title: string };

type EnqueuedMessage = {
    messageId: string;
    message: UserMessageContentType;
    voiceInput?: boolean;
    voiceOutput?: VoiceOutputMode;
    searchEnabled?: boolean;
    middlePaneContext?: MiddlePaneContext;
};

export interface IMessageQueue {
    enqueue(runId: string, message: UserMessageContentType, voiceInput?: boolean, voiceOutput?: VoiceOutputMode, searchEnabled?: boolean, middlePaneContext?: MiddlePaneContext): Promise<string>;
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

    async enqueue(runId: string, message: UserMessageContentType, voiceInput?: boolean, voiceOutput?: VoiceOutputMode, searchEnabled?: boolean, middlePaneContext?: MiddlePaneContext): Promise<string> {
        if (!this.store[runId]) {
            this.store[runId] = [];
        }
        const id = await this.idGenerator.next();
        this.store[runId].push({
            messageId: id,
            message,
            voiceInput,
            voiceOutput,
            searchEnabled,
            middlePaneContext,
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
