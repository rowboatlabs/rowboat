import { IScheduledJobRulesRepository } from "@/src/application/repositories/scheduled-job-rules.repository.interface";
import { IJobsRepository } from "@/src/application/repositories/jobs.repository.interface";
import { IProjectsRepository } from "@/src/application/repositories/projects.repository.interface";
import { IPubSubService } from "@/src/application/services/pub-sub.service.interface";
import { ScheduledJobRule } from "@/src/entities/models/scheduled-job-rule";
import { z } from "zod";
import { nanoid } from "nanoid";
import { PrefixLogger } from "@/app/lib/utils";

export interface IScheduledJobRulesWorker {
    run(): Promise<void>;
    stop(): Promise<void>;
}

export class ScheduledJobRulesWorker implements IScheduledJobRulesWorker {
    private readonly scheduledJobRulesRepository: IScheduledJobRulesRepository;
    private readonly jobsRepository: IJobsRepository;
    private readonly projectsRepository: IProjectsRepository;
    private readonly pubSubService: IPubSubService;
    private readonly pollIntervalMs: number = 60_000; // 1 minute
    private workerId: string;
    private logger: PrefixLogger;
    private isRunning: boolean = false;
    private pollTimeoutId: NodeJS.Timeout | null = null;

    constructor({
        scheduledJobRulesRepository,
        jobsRepository,
        projectsRepository,
        pubSubService,
    }: {
        scheduledJobRulesRepository: IScheduledJobRulesRepository;
        jobsRepository: IJobsRepository;
        projectsRepository: IProjectsRepository;
        pubSubService: IPubSubService;
    }) {
        this.scheduledJobRulesRepository = scheduledJobRulesRepository;
        this.jobsRepository = jobsRepository;
        this.projectsRepository = projectsRepository;
        this.pubSubService = pubSubService;
        this.workerId = nanoid();
        this.logger = new PrefixLogger(`scheduled-job-rules-worker-[${this.workerId}]`);
    }

    private async processRule(rule: z.infer<typeof ScheduledJobRule>): Promise<void> {
        const logger = this.logger.child(`rule-${rule.id}`);
        logger.log("Processing scheduled job rule");

        try {
            // create job
            const job = await this.jobsRepository.create({
                reason: {
                    type: "scheduled_job_rule",
                    ruleId: rule.id,
                },
                projectId: rule.projectId,
                input: {
                    messages: rule.input.messages,
                },
            });

            // notify job workers
            await this.pubSubService.publish("new_jobs", job.id);
 
            logger.log(`Created job ${job.id} from rule ${rule.id}`);

            // update data
            await this.scheduledJobRulesRepository.update(rule.id, {
                output: {
                    jobId: job.id,
                },
                status: "triggered",
            });

            // release
            await this.scheduledJobRulesRepository.release(rule.id);

           logger.log(`Published job ${job.id} to new_jobs`);
        } catch (error) {
            logger.log(`Failed to process rule: ${error instanceof Error ? error.message : "Unknown error"}`);
            // Always release the rule to avoid deadlocks but do not attach a jobId
            try {
                await this.scheduledJobRulesRepository.release(rule.id);
            } catch (releaseError) {
                logger.log(`Failed to release rule: ${releaseError instanceof Error ? releaseError.message : "Unknown error"}`);
            }
        }
    }

    private async pollRules(): Promise<void> {
        let rule: z.infer<typeof ScheduledJobRule> | null = null;
        try {
            do {
                rule = await this.scheduledJobRulesRepository.poll(this.workerId);
                if (!rule) {
                    return;
                }
                await this.processRule(rule);
            } while (rule);
        } catch (error) {
            this.logger.log(`Error while polling rules: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }

    private scheduleNextPoll(): void {
        this.pollTimeoutId = setTimeout(async () => {
            if (!this.isRunning) return;
            await this.pollRules();
            this.scheduleNextPoll();
        }, this.pollIntervalMs);
    }

    async run(): Promise<void> {
        if (this.isRunning) {
            this.logger.log("Worker already running");
            return;
        }
        this.isRunning = true;
        this.logger.log(`Starting worker ${this.workerId}`);
        this.scheduleNextPoll();
    }

    async stop(): Promise<void> {
        this.logger.log(`Stopping worker ${this.workerId}`);
        this.isRunning = false;
        if (this.pollTimeoutId) {
            clearTimeout(this.pollTimeoutId);
            this.pollTimeoutId = null;
        }
    }
}
