import { ITurnsRepository } from "@/src/application/repositories/turns.repository.interface";
import { BadRequestError, NotAuthorizedError, NotFoundError } from '@/src/entities/errors/common';
import { apiKeysCollection, projectMembersCollection } from "@/app/lib/mongodb";
import { z } from "zod";
import { IPubSubService, ISubscription } from "@/src/application/services/pubsub.service.interface";
import { TurnEvent } from "@/src/entities/models/turn";

const inputSchema = z.object({
    turnId: z.string(),
    lastEventIndex: z.number().optional(),
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
});

export interface IStreamTurnUseCase {
    execute(data: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown>;
}

export class StreamTurnUseCase implements IStreamTurnUseCase {
    private readonly turnsRepository: ITurnsRepository;
    private readonly pubsubService: IPubSubService;

    constructor({
        turnsRepository,
        pubsubService,
    }: {
        turnsRepository: ITurnsRepository,
        pubsubService: IPubSubService,
    }) {
        this.turnsRepository = turnsRepository;
        this.pubsubService = pubsubService;
    }

    async *execute(data: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown> {
        const { turnId, lastEventIndex = -1 } = data;

        // Perform authorization first
        await this.authorizeAccess(data);

        const bufferedEvents: z.infer<typeof TurnEvent>[] = [];
        let subscription: ISubscription | null = null;

        try {
            // Subscribe to Redis Pub/Sub first, buffer messages
            subscription = await this.pubsubService.subscribe(`turn-${turnId}`, (message) => {
                try {
                    const event = TurnEvent.parse(JSON.parse(message));
                    bufferedEvents.push(event);
                } catch (error) {
                    console.error('Failed to parse pubsub message:', error);
                }
            });

            // Fetch turn data
            const turn = await this.turnsRepository.getTurn(turnId);
            if (!turn) {
                throw new NotFoundError('Turn not found');
            }

            // If turn is already completed, yield the terminal event and return
            if (turn.status === "completed") {
                yield {
                    type: "done",
                    turn: turn
                } as z.infer<typeof TurnEvent>;
                return;
            }

            // Stream DB messages first
            let maxYieldedIndex = lastEventIndex;
            for (const [index, message] of turn.messages.entries()) {
                if (index <= lastEventIndex) {
                    continue;
                }
                yield {
                    type: "message",
                    data: message,
                    index,
                };
                maxYieldedIndex = index;
            }

            // If the turn has errored, send error event and return
            if (turn.status === "failed") {
                yield {
                    type: "error",
                    error: turn.error || "Run failed"
                } as z.infer<typeof TurnEvent>;
                return;
            }

            // Flush buffered Pub/Sub messages
            for (const event of bufferedEvents) {
                if (event.type === "message" && event.index <= maxYieldedIndex) {
                    continue;
                }
                yield event;
            }

            // Continue yielding real-time events
            const eventGenerator = this.createEventGenerator(bufferedEvents, maxYieldedIndex);
            for await (const event of eventGenerator) {
                yield event;
                if (event.type === "message") {
                    maxYieldedIndex = Math.max(maxYieldedIndex, event.index);
                }
            }

        } finally {
            // Clean up subscription
            if (subscription) {
                await subscription.unsubscribe();
            }
        }
    }

    private async *createEventGenerator(
        bufferedEvents: z.infer<typeof TurnEvent>[],
        maxYieldedIndex: number
    ): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown> {
        // First yield any remaining buffered events
        while (bufferedEvents.length > 0) {
            const event = bufferedEvents.shift()!;
            if (event.type === "message" && event.index <= maxYieldedIndex) {
                continue;
            }
            yield event;
            
            // Exit if we encounter a terminal event
            if (event.type === "done" || event.type === "error") {
                return;
            }
        }

        // Then wait for and yield new real-time events
        while (true) {
            // Wait for new events to arrive
            await new Promise<void>((resolve) => {
                const checkForEvents = () => {
                    if (bufferedEvents.length > 0) {
                        resolve();
                    } else {
                        setTimeout(checkForEvents, 50);
                    }
                };
                checkForEvents();
            });

            // Yield all available events
            while (bufferedEvents.length > 0) {
                const event = bufferedEvents.shift()!;
                if (event.type === "message" && event.index <= maxYieldedIndex) {
                    continue;
                }
                yield event;
                
                // Exit if we encounter a terminal event
                if (event.type === "done" || event.type === "error") {
                    return;
                }
            }
        }
    }

    private async authorizeAccess(data: z.infer<typeof inputSchema>): Promise<void> {
        const { turnId } = data;

        // fetch run data for authorization
        const turn = await this.turnsRepository.getTurn(turnId);
        if (!turn) {
            throw new NotFoundError('Turn not found');
        }

        const { projectId } = turn;

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