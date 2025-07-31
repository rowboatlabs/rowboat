import { container } from "@/di/container";
import { IRunsRepository } from "@/src/application/repositories/runs.repository.interface";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { getCustomerIdForProject, logUsage } from "@/app/lib/billing";
import { streamResponse } from "../lib/agents";
import { Message } from "../lib/types/types";
import { PrefixLogger } from "../lib/utils";
import { z } from "zod";

const runsRepo = container.resolve<IRunsRepository>("runsRepository");
const HOST_NAME = process.env.HOST || "worker-1";
const WORKER_COUNT = parseInt(process.env.WORKERS || "1", 10);

// Worker function to process a single job
async function processJob(workerId: string) {
    const logger = new PrefixLogger(`worker-${workerId}`);
    logger.log(`starting worker ${workerId}`);

    while (true) {
        try {
            // fetch next run
            const run = await runsRepo.pollRuns(workerId);

            // nothing to run? sleep and try again
            if (!run) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
            }

            let billingCustomerId: string | null = null;
            const runLogger = logger.child(`run-${run.id}`);
            const msgs: z.infer<typeof Message>[] = [];
            let error: string | null = null;
            runLogger.log('starting run');

            try {

                // fetch billing customer id
                if (USE_BILLING) {
                    billingCustomerId = await getCustomerIdForProject(run.projectId);
                    runLogger.log('billing customer id', billingCustomerId);
                }

                // collect events
                for await (const event of streamResponse(run.projectId, run.workflow, run.messages)) {
                    runLogger.log('got event', JSON.stringify(event));
                    if ("role" in event) {
                        msgs.push({
                            ...event,
                            timestamp: new Date().toISOString(),
                        });
                    }
                }
            } catch (error) {
                runLogger.log('Error processing job:', error);
                error = error instanceof Error ? error.message : "Unknown error";
            } finally {
                // save events and mark run as completed
                await runsRepo.saveRun(run.id, {
                    status: error ? "failed" : "completed",
                    ...(error ? { error } : {}),
                    messages: {
                        ...run.messages,
                        ...msgs,
                    },
                });
                runLogger.log("updated run state");

                // log billing usage
                if (USE_BILLING && billingCustomerId) {
                    await logUsage(billingCustomerId, {
                        type: "agent_messages",
                        amount: msgs.filter(e => e.role === 'assistant').length,
                    });
                    runLogger.log("logged billing usage");
                }

                runLogger.log('completed');
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