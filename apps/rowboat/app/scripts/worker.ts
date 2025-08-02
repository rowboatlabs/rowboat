import { container } from "@/di/container";
import { ITurnsRepository } from "@/src/application/repositories/turns.repository.interface";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { getCustomerIdForProject, logUsage } from "@/app/lib/billing";
import { streamResponse } from "../lib/agents";
import { Message } from "../lib/types/types";
import { PrefixLogger } from "../lib/utils";
import { IPubSubService } from "@/src/application/services/pubsub.service.interface";
import { z } from "zod";
import { TurnEvent } from "@/src/entities/models/turn";

const turnsRepo = container.resolve<ITurnsRepository>("turnsRepository");
const pubsubService = container.resolve<IPubSubService>("pubsubService");
const HOST_NAME = process.env.HOST || "worker-1";
const WORKER_COUNT = parseInt(process.env.WORKERS || "1", 10);

async function publish(topic: string, event: z.infer<typeof TurnEvent>): Promise<void> {
    const serialised = JSON.stringify(event);
    console.log('!! publishing event', topic, serialised);
    await pubsubService.publish(topic, serialised);
}

// Worker function to process a single job
async function processJob(workerId: string) {
    const logger = new PrefixLogger(`worker-${workerId}`);
    logger.log(`starting worker ${workerId}`);

    while (true) {
        try {
            // fetch next job
            const turn = await turnsRepo.pollTurns(workerId);

            // nothing to do? sleep and try again
            if (!turn) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
            }

            const topic = `turn-${turn.id}`;
            let billingCustomerId: string | null = null;
            const turnLogger = logger.child(`turn-${turn.id}`);
            const generatedMessages: z.infer<typeof Message>[] = [];
            let index = 0;
            let errorState: string | null = null;
            turnLogger.log('>>> starting turn');

            try {
                // fetch billing customer id
                if (USE_BILLING) {
                    billingCustomerId = await getCustomerIdForProject(turn.projectId);
                    turnLogger.log('billing customer id', billingCustomerId);
                }

                // fetch previous conversation turns and pull message history
                const allTurns = await turnsRepo.getConversationTurns(turn.conversationId);
                const previousTurns = allTurns.filter(t => t.id !== turn.id);
                const conversationMessages = previousTurns.flatMap(t => t.messages);
                const inputMessages = [
                    ...conversationMessages,
                    ...turn.triggerData.messages,
                ]

                // call agents runtime and handle generated messages
                for await (const event of streamResponse(turn.projectId, turn.triggerData.workflow, inputMessages)) {
                    turnLogger.log('got event', JSON.stringify(event));

                    // handle message events
                    if ("role" in event) {
                        // save message to turn
                        await turnsRepo.addMessages(turn.id, {
                            messages: [event],
                        });

                        // collect generated message
                        const msg = {
                            ...event,
                            timestamp: new Date().toISOString(),
                        };
                        generatedMessages.push(msg);

                        // publish generated messages to topic
                        await publish(topic, {
                            type: "message",
                            data: msg,
                            index,
                        });

                        // increment index
                        index++;
                    }
                }
            } catch (err) {
                turnLogger.log('Error processing turn:', err);
                errorState = err instanceof Error ? err.message : "Unknown error";
                await publish(topic, {
                    type: "error",
                    error: err instanceof Error ? err.message : "Unknown error",
                });
            } finally {
                // mark turn as completed
                const updatedTurn = await turnsRepo.saveTurn(turn.id, {
                    status: errorState ? "failed" : "completed",
                    ...(errorState ? { error: errorState } : {}),
                });
                turnLogger.log("updated turn state");

                // emit done event
                if (!errorState) {
                    await publish(topic, {
                        type: "done",
                        turn: updatedTurn,
                    });
                }

                // log billing usage
                if (USE_BILLING && billingCustomerId) {
                    await logUsage(billingCustomerId, {
                        type: "agent_messages",
                        amount: generatedMessages.filter(e => e.role === 'assistant').length,
                    });
                    turnLogger.log("logged billing usage");
                }

                // release lock
                await turnsRepo.releaseTurn(turn.id);

                turnLogger.log('<< completed turn');
            }
        } catch (error) {
            logger.log('Error processing job:', error);
            // Continue processing other jobs even if one fails
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

(async () => {
    const mainLogger = new PrefixLogger("worker-main");
    mainLogger.log(`Starting worker with ${WORKER_COUNT} concurrent jobs`);

    // Start multiple worker processes
    const workers = Array.from({ length: WORKER_COUNT }, (_, i) =>
        processJob(`${HOST_NAME}-${i + 1}`)
    );

    // Wait for all workers to complete (they run indefinitely)
    await Promise.all(workers);
})();