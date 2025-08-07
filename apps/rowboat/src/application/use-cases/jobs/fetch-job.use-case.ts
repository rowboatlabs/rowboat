import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IJobsRepository } from '../../repositories/jobs.repository.interface';
import { Job } from '@/src/entities/models/job';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    jobId: z.string(),
});

export interface IFetchJobUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Job>>;
}

export class FetchJobUseCase implements IFetchJobUseCase {
    private readonly jobsRepository: IJobsRepository;   
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        jobsRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        jobsRepository: IJobsRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.jobsRepository = jobsRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Job>> {
        // fetch job first to get projectId
        const job = await this.jobsRepository.fetch(request.jobId);
        if (!job) {
            throw new NotFoundError(`Job ${request.jobId} not found`);
        }

        // extract projectid from job
        const { projectId } = job;

        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // return the job
        return job;
    }
}
