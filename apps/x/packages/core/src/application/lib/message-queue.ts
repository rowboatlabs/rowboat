import { IMonotonicallyIncreasingIdGenerator } from "./id-gen.js";
import { UserMessageContent } from "@x/shared/dist/message.js";
import z from "zod";

export type UserMessageContentType = z.infer<typeof UserMessageContent>;
export type VoiceOutputMode = 'summary' | 'full';
export type MiddlePaneContext =
    | { kind: 'note'; path: string; content: string }
    | { kind: 'browser'; url: string; title: string };

export type CodeMode = 'claude' | 'codex';
export type CodePolicy = 'ask' | 'auto-approve-reads' | 'yolo';

type EnqueuedMessage = {
    messageId: string;
    message: UserMessageContentType;
    voiceInput?: boolean;
    voiceOutput?: VoiceOutputMode;
    searchEnabled?: boolean;
    codeMode?: CodeMode;
    // Code-section sessions pin the coding agent's working directory and
    // approval policy for the turn (code_agent_run honors these over its
    // model-provided arguments / the global policy).
    codeCwd?: string;
    codePolicy?: CodePolicy;
    middlePaneContext?: MiddlePaneContext;
};

export interface IMessageQueue {
    enqueue(runId: string, message: UserMessageContentType, voiceInput?: boolean, voiceOutput?: VoiceOutputMode, searchEnabled?: boolean, middlePaneContext?: MiddlePaneContext, codeMode?: CodeMode, codeCwd?: string, codePolicy?: CodePolicy): Promise<string>;
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

    async enqueue(runId: string, message: UserMessageContentType, voiceInput?: boolean, voiceOutput?: VoiceOutputMode, searchEnabled?: boolean, middlePaneContext?: MiddlePaneContext, codeMode?: CodeMode, codeCwd?: string, codePolicy?: CodePolicy): Promise<string> {
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
            codeMode,
            codeCwd,
            codePolicy,
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
