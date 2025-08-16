import { z } from "zod";
import { IDataSourceDocsRepository } from "@/src/application/repositories/data-source-docs.repository.interface";
import { IDataSourcesRepository } from "@/src/application/repositories/data-sources.repository.interface";
import { IUsageQuotaPolicy } from "@/src/application/policies/usage-quota.policy.interface";
import { IProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";
import { NotFoundError } from "@/src/entities/errors/common";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    docId: z.string(),
});

export interface IDeleteDocFromDataSourceUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class DeleteDocFromDataSourceUseCase implements IDeleteDocFromDataSourceUseCase {
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
        const { docId } = request;

        const doc = await this.dataSourceDocsRepository.fetch(docId);
        if (!doc) {
            throw new NotFoundError(`Doc ${docId} not found`);
        }

        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId: doc.projectId,
        });

        await this.usageQuotaPolicy.assertAndConsume(doc.projectId);

        await this.dataSourceDocsRepository.markAsDeleted(docId);

        await this.dataSourcesRepository.update(doc.sourceId, {
            status: 'pending',
            billingError: null,
            attempts: 0,
        }, true);
    }
}