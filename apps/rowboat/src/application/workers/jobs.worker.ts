import { IJobsRepository } from "@/src/application/repositories/jobs.repository.interface";
import { ICreateConversationUseCase } from "../use-cases/conversations/create-conversation.use-case";
import { IRunConversationTurnUseCase } from "../use-cases/conversations/run-conversation-turn.use-case";
import { Job } from "@/src/entities/models/job";
import { Turn } from "@/src/entities/models/turn";
import { nanoid } from "nanoid";
import { z } from "zod";

export interface IJobsWorker {
    run(): Promise<void>;
}

export class JobsWorker implements IJobsWorker {
    private readonly jobsRepository: IJobsRepository;
    private readonly createConversationUseCase: ICreateConversationUseCase;
    private readonly runConversationTurnUseCase: IRunConversationTurnUseCase;
    private workerId;

    constructor({
        jobsRepository,
        createConversationUseCase,
        runConversationTurnUseCase,
    }: {
        jobsRepository: IJobsRepository;
        createConversationUseCase: ICreateConversationUseCase;
        runConversationTurnUseCase: IRunConversationTurnUseCase;
    }) {
        this.jobsRepository = jobsRepository;
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
            const stream = this.runConversationTurnUseCase.execute({
                caller: "job_worker",
                conversationId: conversation.id,
                reason: {
                    type: "job",
                    jobId: job.id,
                },
                input: {
                    messages: job.input.messages,
                },
            });
            let turn: z.infer<typeof Turn> | null = null;
            for await (const event of stream) {
                if (event.type === "done") {
                    turn = event.turn;
                }
            }
            if (!turn) {
                throw new Error("Turn not created");
            }

            // update job
            await this.jobsRepository.update(job.id, {
                status: "completed",
                output: {
                    conversationId: conversation.id,
                    turnId: turn.id,
                },
            });
        } catch (error) {
            // update job
            await this.jobsRepository.update(job.id, {
                status: "failed",
                output: {
                    error: error instanceof Error ? error.message : "Unknown error",
                },
            });
        } finally {
            // release job
            await this.jobsRepository.release(job.id);
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