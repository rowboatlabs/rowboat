import { ITurnsRepository } from "@/src/application/repositories/turns.repository.interface";
import { BadRequestError, BillingError, NotAuthorizedError, NotFoundError } from '@/src/entities/errors/common';
import { check_query_limit } from "@/app/lib/rate_limiting";
import { QueryLimitError } from "@/src/entities/errors/common";
import { apiKeysCollection, projectMembersCollection } from "@/app/lib/mongodb";
import { z } from "zod";
import { IPubSubService, ISubscription } from "@/src/application/services/pubsub.service.interface";
import { TurnEvent } from "@/src/entities/models/turn";

const inputSchema = z.object({
    fromIndex: z.number().optional().default(0), // Start streaming from this message index
    turnId: z.string(),
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
});

export interface IStreamTurnUseCase {
    execute(data: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown>;
}

export class StreamTurnUseCase implements IStreamTurnUseCase {
    constructor(private readonly turnsRepository: ITurnsRepository, private readonly pubsubService: IPubSubService) {}

    async *execute(data: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown> {
        const { turnId: runId, fromIndex } = data;

        // Perform authorization first
        await this.authorizeAccess(data);

        // Buffer for pubsub messages with their indices
        interface BufferedEvent {
            event: z.infer<typeof TurnEvent>;
            messageIndex?: number;
        }
        const bufferedEvents: BufferedEvent[] = [];
        let subscription: ISubscription | null = null;
        let isSubscribed = false;
        
        try {
            // 1. Subscribe to Redis Pub/Sub first, buffer messages
            subscription = await this.pubsubService.subscribe(`run-${runId}`, (message) => {
                try {
                    const parsedMessage = JSON.parse(message);
                    const event = parsedMessage.event as z.infer<typeof TurnEvent>;
                    const messageIndex = parsedMessage.messageIndex as number | undefined;
                    
                    bufferedEvents.push({
                        event,
                        messageIndex
                    });
                } catch (error) {
                    console.error('Failed to parse pubsub message:', error);
                }
            });
            isSubscribed = true;

            // 2. Fetch messages from DB from fromIndex onwards
            const run = await this.turnsRepository.getTurn(runId);
            if (!run) {
                throw new NotFoundError('Run not found');
            }

            // 3. Stream DB messages first
            const dbMessages = run.messages.slice(fromIndex);
            const dbSnapshotLength = run.messages.length;
            
            for (let i = 0; i < dbMessages.length; i++) {
                const message = dbMessages[i];
                yield {
                    type: "message",
                    data: message
                } as z.infer<typeof TurnEvent>;
            }

            // If the run is already completed or failed, yield the terminal event
            if (run.status === "completed") {
                yield {
                    type: "done",
                    turn: run
                } as z.infer<typeof TurnEvent>;
                return; // End streaming for completed runs
            } else if (run.status === "failed") {
                yield {
                    type: "error",
                    error: run.error || "Run failed"
                } as z.infer<typeof TurnEvent>;
                return; // End streaming for failed runs
            }

            // 4. Flush buffered Pub/Sub messages (with index > snapshot)
            const relevantBufferedEvents = bufferedEvents.filter(buffered => 
                buffered.messageIndex === undefined || buffered.messageIndex >= dbSnapshotLength
            );
            
            for (const buffered of relevantBufferedEvents) {
                yield buffered.event;
                
                // Check if this is a terminal event
                if (buffered.event.type === "done" || buffered.event.type === "error") {
                    return;
                }
            }

            // Clear the processed buffered events
            bufferedEvents.splice(0, relevantBufferedEvents.length);

            // 5. Continue streaming new messages from Pub/Sub in order
            let pollAttempts = 0;
            const maxPollAttempts = 300; // 30 seconds with 100ms intervals
            
            while (pollAttempts < maxPollAttempts) {
                if (bufferedEvents.length > 0) {
                    const buffered = bufferedEvents.shift()!;
                    yield buffered.event;
                    
                    // Reset poll attempts when we receive events
                    pollAttempts = 0;
                    
                    // Check if this is a terminal event
                    if (buffered.event.type === "done" || buffered.event.type === "error") {
                        break;
                    }
                } else {
                    // Check current run status to see if it's completed
                    const currentRun = await this.turnsRepository.getTurn(runId);
                    if (currentRun && (currentRun.status === "completed" || currentRun.status === "failed")) {
                        // Yield final state if not already yielded
                        if (bufferedEvents.length === 0) {
                            yield {
                                type: currentRun.status === "failed" ? "error" : "done",
                                ...(currentRun.status === "failed" 
                                    ? { error: currentRun.error || "Run failed" }
                                    : { turn: currentRun }
                                )
                            } as z.infer<typeof TurnEvent>;
                        }
                        break;
                    }
                    
                    // Wait a bit before checking again
                    await new Promise(resolve => setTimeout(resolve, 100));
                    pollAttempts++;
                }
            }
            
            if (pollAttempts >= maxPollAttempts) {
                console.warn(`Stream timeout reached for runId: ${runId}`);
            }
        } finally {
            // Clean up subscription
            if (subscription && isSubscribed) {
                await subscription.unsubscribe();
            }
        }
    }

    private async authorizeAccess(data: z.infer<typeof inputSchema>): Promise<void> {
        const { turnId: runId } = data;

        // fetch run data for authorization
        const run = await this.turnsRepository.getTurn(runId);
        if (!run) {
            throw new NotFoundError('Run not found');
        }

        const { projectId } = run;

        // if caller is a user, ensure they are a member of project
        if (data.caller === "user") {
            if (!data.userId) {
                throw new Error('User ID is required');
            }
            const membership = await projectMembersCollection.findOne({
                projectId,
                userId: data.userId,
            });
            if (!membership) {
                throw new NotAuthorizedError('User not a member of project');
            }
        } else {
            if (!data.apiKey) {
                throw new BadRequestError('API key is required');
            }
            // check if api key is valid
            // while also updating last used timestamp
            const result = await apiKeysCollection.findOneAndUpdate(
                {
                    projectId,
                    key: data.apiKey,
                },
                { $set: { lastUsedAt: new Date().toISOString() } }
            );
            if (!result) {
                throw new NotAuthorizedError('Invalid API key');
            }
        }
    }
}