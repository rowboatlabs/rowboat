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
    // Run polls aligned to minute marks at this offset (e.g., 2000 ms => :02 each minute)
    private readonly minuteAlignmentOffsetMs: number = 2_000;
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

    // Calculates delay so the next run happens at next minute + minuteAlignmentOffsetMs
    private calculateDelayToNextAlignedMinute(): number {
        const now = new Date();
        const millisecondsUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
        const delayMs = millisecondsUntilNextMinute + this.minuteAlignmentOffsetMs;
        return delayMs > 0 ? delayMs : this.minuteAlignmentOffsetMs;
    }

    private async pollAndProcess(): Promise<void> {
        this.logger.log("Polling...");
        let rule: z.infer<typeof ScheduledJobRule> | null = null;
        try {
            do {
                rule = await this.scheduledJobRulesRepository.poll(this.workerId);
                if (!rule) {
                    this.logger.log("No rules to process");
                    return;
                }
                await this.processRule(rule);
            } while (rule);
        } catch (error) {
            this.logger.log(`Error while polling rules: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }

    private scheduleNextPoll(): void {
        const delayMs = this.calculateDelayToNextAlignedMinute();
        this.logger.log(`Scheduling next poll in ${delayMs} ms`);
        this.pollTimeoutId = setTimeout(async () => {
            if (!this.isRunning) return;
            await this.pollAndProcess();
            this.scheduleNextPoll();
        }, delayMs);
    }

    async run(): Promise<void> {
        if (this.isRunning) {
            this.logger.log("Worker already running");
            return;
        }
        this.isRunning = true;
        this.logger.log(`Starting worker ${this.workerId}`);
        // No immediate polling; align to 2s past the next minute
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
