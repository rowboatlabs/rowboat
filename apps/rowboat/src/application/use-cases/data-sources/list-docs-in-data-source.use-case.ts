import { z } from "zod";
import { IDataSourceDocsRepository } from "@/src/application/repositories/data-source-docs.repository.interface";
import { IDataSourcesRepository } from "@/src/application/repositories/data-sources.repository.interface";
import { IUsageQuotaPolicy } from "@/src/application/policies/usage-quota.policy.interface";
import { IProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";
import { DataSourceDoc } from "@/src/entities/models/data-source-doc";
import { NotFoundError } from "@/src/entities/errors/common";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    sourceId: z.string(),
});

export interface IListDocsInDataSourceUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSourceDoc>[]>;
}

export class ListDocsInDataSourceUseCase implements IListDocsInDataSourceUseCase {
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

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSourceDoc>[]> {
        const { sourceId } = request;

        const source = await this.dataSourcesRepository.fetch(sourceId);
        if (!source) {
            throw new NotFoundError(`Data source ${sourceId} not found`);
        }

        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId: source.projectId,
        });

        await this.usageQuotaPolicy.assertAndConsume(source.projectId);

        // fetch all docs
        const docs = [];
        let cursor = undefined;
        do {
            const result = await this.dataSourceDocsRepository.list(sourceId, undefined, cursor);
            docs.push(...result.items);
            cursor = result.nextCursor;
        } while (cursor);

        return docs;
    }
}