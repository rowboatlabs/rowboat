import { IJobsRepository } from "@/src/application/repositories/jobs.repository.interface";
import { ICreateConversationUseCase } from "../use-cases/conversations/create-conversation.use-case";
import { IRunConversationTurnUseCase } from "../use-cases/conversations/run-conversation-turn.use-case";
import { Job } from "@/src/entities/models/job";
import { Turn } from "@/src/entities/models/turn";
import { IPubSubService, Subscription } from "../services/pub-sub.service.interface";
import { nanoid } from "nanoid";
import { z } from "zod";
import { PrefixLogger } from "@/app/lib/utils";

export interface IJobsWorker {
    run(): Promise<void>;
    stop(): Promise<void>;
}

export class JobsWorker implements IJobsWorker {
    private readonly jobsRepository: IJobsRepository;
    private readonly createConversationUseCase: ICreateConversationUseCase;
    private readonly runConversationTurnUseCase: IRunConversationTurnUseCase;
    private readonly pubSubService: IPubSubService;
    private workerId: string;
    private subscription: Subscription | null = null;
    private isRunning: boolean = false;
    private pollInterval: number = 5000; // 5 seconds
    private logger: PrefixLogger;
    private pollTimeoutId: NodeJS.Timeout | null = null;

    constructor({
        jobsRepository,
        createConversationUseCase,
        runConversationTurnUseCase,
        pubSubService,
    }: {
        jobsRepository: IJobsRepository;
        createConversationUseCase: ICreateConversationUseCase;
        runConversationTurnUseCase: IRunConversationTurnUseCase;
        pubSubService: IPubSubService;
    }) {
        this.jobsRepository = jobsRepository;
        this.createConversationUseCase = createConversationUseCase;
        this.runConversationTurnUseCase = runConversationTurnUseCase;
        this.pubSubService = pubSubService;
        this.workerId = nanoid();
        this.logger = new PrefixLogger(`jobs-worker-[${this.workerId}]`);
    }

    async processJob(job: z.infer<typeof Job>): Promise<void> {
        const logger = this.logger.child(`job-${job.id}`);
        logger.log('Processing job');
        
        try {
            // extract project id from job
            const { projectId } = job;

            // create conversation
            logger.log('Creating conversation');
            const conversation = await this.createConversationUseCase.execute({
                caller: "job_worker",
                projectId,
                workflow: job.input.workflow,
                isLiveWorkflow: true,
            });
            logger.log(`Created conversation ${conversation.id}`);

            // run turn
            logger.log('Running turn');
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
                logger.log(`Received event: ${event.type}`);
                if (event.type === "done") {
                    turn = event.turn;
                }
            }
            if (!turn) {
                throw new Error("Turn not created");
            }
            logger.log(`Completed turn ${turn.id}`);

            // update job
            await this.jobsRepository.update(job.id, {
                status: "completed",
                output: {
                    conversationId: conversation.id,
                    turnId: turn.id,
                },
            });
            logger.log(`Completed successfully`);
        } catch (error) {
            logger.log(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
            
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
            logger.log(`Released`);
        }
    }

    private async handleNewJobMessage(message: string): Promise<void> {
        const logger = this.logger.child(`handle-new-job-message-${message}`);
        try {
            const jobId = message.trim();
            if (!jobId) {
                logger.log("Received empty job ID");
                return;
            }

            // Try to lock the specific job
            let job: z.infer<typeof Job> | null = null;
            try {
                job = await this.jobsRepository.lock(jobId, this.workerId);
                logger.log(`Successfully locked job`);
            } catch (error) {
                // Job might already be locked by another worker or doesn't exist
                logger.log(`Failed to lock job: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            if (!job) {
                logger.log("Job not found");
                return;
            }
            logger.log(`Processing job ${job.id}`);
            await this.processJob(job);
            logger.log(`Processed job ${job.id}`);
        } catch (error) {
            logger.log(`Error handling new job message: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async pollForJobs(): Promise<void> {
        const logger = this.logger.child(`poll-for-jobs`);
        try {
            // fetch next job
            const job = await this.jobsRepository.poll(this.workerId);

            // if no job found, return early
            if (!job) {
                return;
            }

            logger.log(`Found job ${job.id} via polling`);
            
            // process job
            await this.processJob(job);
        } catch (error) {
            logger.log(`Error polling for jobs: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async startPolling(): Promise<void> {
        const logger = this.logger.child(`start-polling`);
        logger.log("Starting polling mechanism");
        
        const scheduleNextPoll = () => {
            this.pollTimeoutId = setTimeout(async () => {
                await this.pollForJobs();
                // Schedule the next poll after this one completes
                scheduleNextPoll();
            }, this.pollInterval);
        };

        // Start the first poll
        scheduleNextPoll();
    }

    private async startSubscription(): Promise<void> {
        const logger = this.logger.child(`start-subscription`);
        try {
            logger.log("Subscribing to new_jobs topic");
            this.subscription = await this.pubSubService.subscribe(
                'new_jobs',
                (message: string) => {
                    // Handle the message asynchronously to avoid blocking the subscription
                    this.handleNewJobMessage(message).catch(error => {
                        logger.log(`Error handling subscription message: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    });
                }
            );
            logger.log("Successfully subscribed to new_jobs topic");
        } catch (error) {
            logger.log(`Failed to subscribe to new_jobs topic: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async run(): Promise<void> {
        if (this.isRunning) {
            this.logger.log("Worker is already running");
            return;
        }

        this.isRunning = true;
        this.logger.log(`Starting worker ${this.workerId}`);

        try {
            // Start subscription to new_jobs topic
            await this.startSubscription();

            // Start polling as a fallback mechanism (run concurrently)
            // We run both operations concurrently - the subscription will handle immediate jobs
            // while polling will catch any jobs that slipped through
            await this.startPolling();
        } catch (error) {
            this.logger.log(`Error in worker run loop: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            this.isRunning = false;
            this.logger.log("Worker run loop ended");
        }
    }

    async stop(): Promise<void> {
        this.logger.log(`Stopping worker ${this.workerId}`);
        this.isRunning = false;

        // Clear any pending polls
        if (this.pollTimeoutId) {
            clearTimeout(this.pollTimeoutId);
            this.pollTimeoutId = null;
            this.logger.log("Cleared pending poll timeout");
        }

        // Unsubscribe from the topic
        if (this.subscription) {
            try {
                await this.subscription.unsubscribe();
                this.logger.log("Successfully unsubscribed from new_jobs topic");
            } catch (error) {
                this.logger.log(`Error unsubscribing from new_jobs topic: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            this.subscription = null;
        }
    }
}