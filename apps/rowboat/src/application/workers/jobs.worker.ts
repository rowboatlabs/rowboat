import { USE_BILLING } from "@/app/lib/feature_flags";
import { authorize, logUsage } from "@/app/lib/billing";
import { getCustomerIdForProject } from "@/app/lib/billing";
import { IJobsRepository } from "@/src/application/repositories/jobs.repository.interface";
import { IConversationsRepository } from "@/src/application/repositories/conversations.repository.interface";
import { IProjectsRepository } from "@/src/application/repositories/projects.repository.interface";
import { ICreateConversationUseCase } from "../use-cases/conversations/create-conversation.use-case";
import { IRunConversationTurnUseCase } from "../use-cases/conversations/run-conversation-turn.use-case";
import { getResponse } from "@/app/lib/agents";
import { nanoid } from "nanoid";
import { z } from "zod";
import { Job } from "@/src/entities/models/job";

export interface IJobsWorker {
    run(): Promise<void>;
}

export class JobsWorker implements IJobsWorker {
    private readonly jobsRepository: IJobsRepository;
    private readonly projectsRepository: IProjectsRepository;
    private readonly createConversationUseCase: ICreateConversationUseCase;
    private readonly runConversationTurnUseCase: IRunConversationTurnUseCase;
    private workerId;

    constructor({
        jobsRepository,
        projectsRepository,
        createConversationUseCase,
        runConversationTurnUseCase,
    }: {
        jobsRepository: IJobsRepository;
        projectsRepository: IProjectsRepository;
        createConversationUseCase: ICreateConversationUseCase;
        runConversationTurnUseCase: IRunConversationTurnUseCase;
    }) {
        this.jobsRepository = jobsRepository;
        this.projectsRepository = projectsRepository;
        this.createConversationUseCase = createConversationUseCase;
        this.runConversationTurnUseCase = runConversationTurnUseCase;
        this.workerId = nanoid();
    }

    async processJob(job: z.infer<typeof Job>): Promise<void> {
        try {
            // extract project id from job
            const { projectId } = job;

            // create conversation
            const conversation = await this.createConversationUseCase.execute({
                caller: "job_worker",
                projectId,
                workflow: job.input.workflow,
                isLiveWorkflow: true,
            });

            // run turn
            const iter = this.runConversationTurnUseCase.execute({
                caller: "job_worker",
                conversationId: conversation.id,
                trigger: "job",
                input: {
                    messages: job.input.messages,
                },
            });
        }
    }

    async run(): Promise<void> {
        while (true) {
            // fetch next job
            const job = await this.jobsRepository.pollNextJob(this.workerId);

            // if no job found, go back to sleep
            if (!job) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            // process job
            await this.processJob(job);
        }
    }
}