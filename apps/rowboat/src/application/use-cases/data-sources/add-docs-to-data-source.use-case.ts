import { z } from "zod";
import { IDataSourceDocsRepository, CreateSchema as DocCreateSchema } from "@/src/application/repositories/data-source-docs.repository.interface";
import { IDataSourcesRepository } from "@/src/application/repositories/data-sources.repository.interface";
import { IUsageQuotaPolicy } from "@/src/application/policies/usage-quota.policy.interface";
import { IProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";
import { NotAuthorizedError } from "@/src/entities/errors/common";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    sourceId: z.string(),
    docs: z.array(DocCreateSchema),
});

export interface IAddDocsToDataSourceUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class AddDocsToDataSourceUseCase implements IAddDocsToDataSourceUseCase {
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
        const { projectId, sourceId, docs } = request;

        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        await this.usageQuotaPolicy.assertAndConsume(projectId);

        const source = await this.dataSourcesRepository.fetch(sourceId);
        if (!source || source.projectId !== projectId) {
            throw new NotAuthorizedError('You are not authorized to add docs to this data source');
        }

        await this.dataSourceDocsRepository.bulkCreate(projectId, sourceId, docs);

        if (docs.length > 0 && (source.data.type === 'files_local' || source.data.type === 'files_s3')) {
            await this.dataSourcesRepository.update(sourceId, {
                status: "pending",
                billingError: null,
                attempts: 0,
            }, true);
        }
    }
}