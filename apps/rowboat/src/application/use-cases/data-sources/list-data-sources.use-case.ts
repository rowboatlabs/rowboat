import { z } from "zod";
import { IUsageQuotaPolicy } from "@/src/application/policies/usage-quota.policy.interface";
import { IProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";
import { IDataSourcesRepository } from "@/src/application/repositories/data-sources.repository.interface";
import { DataSource } from "@/src/entities/models/data-source";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
});

export interface IListDataSourcesUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>[]>;
}

export class ListDataSourcesUseCase implements IListDataSourcesUseCase {
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

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>[]> {
        const { projectId } = request;

        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // list all sources for now
        const sources = [];
        let cursor = undefined;
        do {
            const result = await this.dataSourcesRepository.list(projectId, undefined, cursor);
            sources.push(...result.items);
            cursor = result.nextCursor;
        } while (cursor);

        return sources;
    }
}