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
    await pubsubService.publish(topic, JSON.stringify(event));
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

            const pubsubTopic = `turn-${turn.id}`;
            let billingCustomerId: string | null = null;
            const turnLogger = logger.child(`turn-${turn.id}`);
            const msgs: z.infer<typeof Message>[] = [];
            let error: string | null = null;
            turnLogger.log('>>> starting turn');

            try {

                // fetch billing customer id
                if (USE_BILLING) {
                    billingCustomerId = await getCustomerIdForProject(turn.projectId);
                    turnLogger.log('billing customer id', billingCustomerId);
                }

                // collect events
                for await (const event of streamResponse(turn.projectId, turn.triggerData.workflow, turn.messages)) {
                    turnLogger.log('got event', JSON.stringify(event));

                    // handle message events
                    if ("role" in event) {
                        // save message to turn
                        await turnsRepo.addMessages(turn.id, {
                            messages: [event],
                        });

                        // publish message event
                        const msg = {
                            ...event,
                            timestamp: new Date().toISOString(),
                        };
                        msgs.push(msg);
                        await publish(pubsubTopic, {
                            type: "message",
                            data: msg,
                        });
                    }
                }
            } catch (error) {
                turnLogger.log('Error processing turn:', error);
                error = error instanceof Error ? error.message : "Unknown error";
                await publish(pubsubTopic, {
                    type: "error",
                    error: error instanceof Error ? error.message : "Unknown error",
                });
            } finally {
                // mark turn as completed
                const updatedTurn = await turnsRepo.saveTurn(turn.id, {
                    status: error ? "failed" : "completed",
                    ...(error ? { error } : {}),
                });
                turnLogger.log("updated turn state");

                // emit done event
                await publish(pubsubTopic, {
                    type: "done",
                    turn: updatedTurn,
                });

                // log billing usage
                if (USE_BILLING && billingCustomerId) {
                    await logUsage(billingCustomerId, {
                        type: "agent_messages",
                        amount: msgs.filter(e => e.role === 'assistant').length,
                    });
                    turnLogger.log("logged billing usage");
                }

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