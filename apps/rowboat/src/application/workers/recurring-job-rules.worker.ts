import { IRecurringJobRulesRepository } from "@/src/application/repositories/recurring-job-rules.repository.interface";
import { IJobsRepository } from "@/src/application/repositories/jobs.repository.interface";
import { IProjectsRepository } from "@/src/application/repositories/projects.repository.interface";
import { IPubSubService } from "@/src/application/services/pub-sub.service.interface";
import { RecurringJobRule } from "@/src/entities/models/recurring-job-rule";
import { z } from "zod";
import { nanoid } from "nanoid";
import { PrefixLogger } from "@/app/lib/utils";

export interface IRecurringJobRulesWorker {
    run(): Promise<void>;
    stop(): Promise<void>;
}

export class RecurringJobRulesWorker implements IRecurringJobRulesWorker {
    private readonly recurringJobRulesRepository: IRecurringJobRulesRepository;
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
        recurringJobRulesRepository,
        jobsRepository,
        projectsRepository,
        pubSubService,
    }: {
        recurringJobRulesRepository: IRecurringJobRulesRepository;
        jobsRepository: IJobsRepository;
        projectsRepository: IProjectsRepository;
        pubSubService: IPubSubService;
    }) {
        this.recurringJobRulesRepository = recurringJobRulesRepository;
        this.jobsRepository = jobsRepository;
        this.projectsRepository = projectsRepository;
        this.pubSubService = pubSubService;
        this.workerId = nanoid();
        this.logger = new PrefixLogger(`recurring-job-rules-worker-[${this.workerId}]`);
    }

    private async processRule(rule: z.infer<typeof RecurringJobRule>): Promise<void> {
        const logger = this.logger.child(`rule-${rule.id}`);
        logger.log("Processing recurring job rule");

        try {
            // create job
            const job = await this.jobsRepository.create({
                reason: {
                    type: "recurring_job_rule",
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

            // Calculate next run time based on cron expression
            const nextRunAt = this.calculateNextRunTime(rule.cron);

            // release and set next run time
            await this.recurringJobRulesRepository.release(rule.id, nextRunAt);

            logger.log(`Published job ${job.id} to new_jobs, next run at ${nextRunAt}`);
        } catch (error) {
            logger.log(`Failed to process rule: ${error instanceof Error ? error.message : "Unknown error"}`);
            // Always release the rule to avoid deadlocks
            try {
                // Set next run time to 5 minutes from now to avoid immediate retry
                const nextRunAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
                await this.recurringJobRulesRepository.release(rule.id, nextRunAt);
            } catch (releaseError) {
                logger.log(`Failed to release rule: ${releaseError instanceof Error ? releaseError.message : "Unknown error"}`);
            }
        }
    }

    private calculateNextRunTime(cron: string): string {
        const parts = cron.split(' ');
        if (parts.length !== 5) {
            // Fallback to 5 minutes from now if invalid cron
            return new Date(Date.now() + 5 * 60 * 1000).toISOString();
        }
        
        const [minute, hour, day, month, dayOfWeek] = parts;
        const now = new Date();
        const nextRun = new Date(now);
        
        // Simple next run calculation - in production you'd want a proper cron library
        // This handles basic cases like "every minute", "every hour", etc.
        
        if (minute === '*') {
            // Every minute
            nextRun.setMinutes(now.getMinutes() + 1);
        } else if (minute.includes('/')) {
            // Every N minutes
            const [, step] = minute.split('/');
            const stepNum = parseInt(step);
            if (!isNaN(stepNum)) {
                nextRun.setMinutes(now.getMinutes() + stepNum);
            } else {
                nextRun.setMinutes(now.getMinutes() + 1);
            }
        } else {
            // Specific minute
            const targetMinute = parseInt(minute);
            if (!isNaN(targetMinute)) {
                if (targetMinute > now.getMinutes()) {
                    nextRun.setMinutes(targetMinute);
                } else {
                    nextRun.setHours(now.getHours() + 1);
                    nextRun.setMinutes(targetMinute);
                }
            } else {
                nextRun.setMinutes(now.getMinutes() + 1);
            }
        }
        
        nextRun.setSeconds(0);
        nextRun.setMilliseconds(0);
        
        return nextRun.toISOString();
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
        let rule: z.infer<typeof RecurringJobRule> | null = null;
        try {
            do {
                rule = await this.recurringJobRulesRepository.poll(this.workerId);
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
