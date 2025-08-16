import { z } from "zod";
import { IDataSourceDocsRepository } from "@/src/application/repositories/data-source-docs.repository.interface";
import { IDataSourcesRepository } from "@/src/application/repositories/data-sources.repository.interface";
import { IUsageQuotaPolicy } from "@/src/application/policies/usage-quota.policy.interface";
import { IProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";
import { NotFoundError, BadRequestError } from "@/src/entities/errors/common";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    sourceId: z.string(),
});

export interface IRecrawlWebDataSourceUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class RecrawlWebDataSourceUseCase implements IRecrawlWebDataSourceUseCase {
    private readonly dataSourceDocsRepository: IDataSourceDocsRepository;
    private readonly dataSourcesRepository: IDataSourcesRepository;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        dataSourceDocsRepository,
        dataSourcesRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        dataSourceDocsRepository: IDataSourceDocsRepository,
        dataSourcesRepository: IDataSourcesRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.dataSourceDocsRepository = dataSourceDocsRepository;
        this.dataSourcesRepository = dataSourcesRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<void> {
        const source = await this.dataSourcesRepository.fetch(request.sourceId);
        if (!source) {
            throw new NotFoundError(`Data source ${request.sourceId} not found`);
        }

        if (source.data.type !== 'urls') {
            throw new BadRequestError('Invalid data source type');
        }

        const { projectId } = source;

        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        await this.usageQuotaPolicy.assertAndConsume(projectId);

        await this.dataSourceDocsRepository.markSourceDocsPending(request.sourceId);

        await this.dataSourcesRepository.update(request.sourceId, {
            status: 'pending',
            billingError: null,
            attempts: 0,
        }, true);
    }
}