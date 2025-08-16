import { z } from "zod";
import { IUsageQuotaPolicy } from "@/src/application/policies/usage-quota.policy.interface";
import { IProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";
import { IDataSourcesRepository } from "@/src/application/repositories/data-sources.repository.interface";
import { NotFoundError } from "@/src/entities/errors/common";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    sourceId: z.string(),
});

export interface IDeleteDataSourceUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class DeleteDataSourceUseCase implements IDeleteDataSourceUseCase {
    private readonly dataSourcesRepository: IDataSourcesRepository;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        dataSourcesRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        dataSourcesRepository: IDataSourcesRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.dataSourcesRepository = dataSourcesRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<void> {
        const existing = await this.dataSourcesRepository.fetch(request.sourceId);
        if (!existing) {
            throw new NotFoundError(`Data source ${request.sourceId} not found`);
        }

        const { projectId } = existing;

        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        await this.usageQuotaPolicy.assertAndConsume(projectId);

        await this.dataSourcesRepository.update(request.sourceId, {
            status: 'deleted',
            attempts: 0,
            billingError: null,
        }, true);
    }
}