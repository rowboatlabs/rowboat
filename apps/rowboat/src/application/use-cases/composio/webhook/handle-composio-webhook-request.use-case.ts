import { IJobsRepository } from "@/src/application/repositories/jobs.repository.interface";
import { IComposioTriggerDeploymentsRepository } from "@/src/application/repositories/composio-trigger-deployments.repository.interface";
import { Webhook } from "standardwebhooks";
import { z } from "zod";
import { BadRequestError } from "@/src/entities/errors/common";
import { UserMessage } from "@/app/lib/types/types";
import { PrefixLogger } from "@/app/lib/utils";
import { IProjectsRepository } from "@/src/application/repositories/projects.repository.interface";

const WEBHOOK_SECRET = process.env.COMPOSIO_TRIGGERS_WEBHOOK_SECRET || "test";

/*
 {
     "type": "slack_receive_message",
     "timestamp": "2025-08-06T01:49:46.008Z",
     "data": {
       "bot_id": null,
       "channel": "C08PTQKM2DS",
       "channel_type": "channel",
       "team_id": null,
       "text": "test",
       "ts": "1754444983.699449",
       "user": "U077XPW36V9",
       "connection_id": "551d86b3-44e3-4c62-b996-44648ccf77b3",
       "connection_nano_id": "ca_2n0cZnluJ1qc",
       "trigger_nano_id": "ti_dU7LJMfP5KSr",
       "trigger_id": "ec96b753-c745-4f37-b5d8-82a35ce0fa0b",
       "user_id": "987dbd2e-c455-4c8f-8d55-a997a2d7680a"
     }
   }
*/
const requestSchema = z.object({
    headers: z.record(z.string(), z.string()),
    payload: z.string(),
});

const payloadSchema = z.object({
    type: z.string(),
    timestamp: z.string().datetime(),
    data: z.object({
        trigger_nano_id: z.string(),
    }).passthrough(),
});

export interface IHandleCompsioWebhookRequestUseCase {
    execute(request: z.infer<typeof requestSchema>): Promise<void>;
}

export class HandleCompsioWebhookRequestUseCase implements IHandleCompsioWebhookRequestUseCase {
    private readonly composioTriggerDeploymentsRepository: IComposioTriggerDeploymentsRepository;
    private readonly jobsRepository: IJobsRepository;
    private readonly projectsRepository: IProjectsRepository;
    private webhook;

    constructor({
        composioTriggerDeploymentsRepository,
        jobsRepository,
        projectsRepository,
    }: {
        composioTriggerDeploymentsRepository: IComposioTriggerDeploymentsRepository;
        jobsRepository: IJobsRepository;
        projectsRepository: IProjectsRepository;
    }) {
        this.composioTriggerDeploymentsRepository = composioTriggerDeploymentsRepository;
        this.jobsRepository = jobsRepository;
        this.projectsRepository = projectsRepository;
        this.webhook = new Webhook(WEBHOOK_SECRET);
    }

    async execute(request: z.infer<typeof requestSchema>): Promise<void> {
        const { headers, payload } = request;

        // verify payload
        // try {
        //     this.webhook.verify(payload, headers);
        // } catch (error) {
        //     throw new BadRequestError("Payload verification failed");
        // }

        // parse event
        let event: z.infer<typeof payloadSchema>;
        try {
            event = payloadSchema.parse(JSON.parse(payload));
        } catch (error) {
            throw new BadRequestError("Invalid webhook payload");
        }

        const logger = new PrefixLogger(`composio-trigger-webhook-[${event.type}]-[${event.data.trigger_nano_id}]`);

        // create a job for each deployment across all pages
        const msg: z.infer<typeof UserMessage> = {
            role: "user",
            content: `This chat is being invoked through a trigger. Here is the trigger data:\n\n${JSON.stringify(event, null, 2)}`,
        };

        // fetch registered trigger deployments for this event type
        let cursor: string | null = null;
        let jobs = 0;
        do {
            const triggerDeployments = await this.composioTriggerDeploymentsRepository.listByTriggerId(event.data.trigger_nano_id, cursor || undefined);

            // create a job for each deployment in the current page
            for (const deployment of triggerDeployments.items) {
                // fetch project
                const project = await this.projectsRepository.fetch(deployment.projectId);
                if (!project) {
                    logger.log(`Project ${deployment.projectId} not found`);
                    continue;
                }

                // ensure workflow
                if (!project.liveWorkflow) {
                    logger.log(`Project ${deployment.projectId} has no live workflow`);
                    continue;
                }

                // create job
                const job = await this.jobsRepository.create({
                    reason: {
                        type: "composio_trigger",
                        triggerId: event.data.trigger_nano_id,
                        triggerDeploymentId: deployment.id,
                        triggerTypeSlug: deployment.triggerTypeSlug,
                        payload: event.data,
                    },
                    projectId: deployment.projectId,
                    input: {
                        workflow: project.liveWorkflow,
                        messages: [msg],
                    },
                });
                jobs++;
                logger.log(`Created job ${job.id} for trigger deployment ${deployment.id}`);
            }

            // check if there are more pages
            cursor = triggerDeployments.nextCursor;
        } while (cursor);

        logger.log(`Created ${jobs} jobs for trigger ${event.data.trigger_nano_id}`);
    }
}
