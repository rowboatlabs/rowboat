import { z } from "zod";
import { DataSource } from "@/src/entities/models/data-source";
import { IUsageQuotaPolicy } from "@/src/application/policies/usage-quota.policy.interface";
import { IProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";
import { IDataSourcesRepository, CreateSchema } from "@/src/application/repositories/data-sources.repository.interface";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    data: CreateSchema,
});

export interface ICreateDataSourceUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>>;
}

export class CreateDataSourceUseCase implements ICreateDataSourceUseCase {
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

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>> {
        const { projectId } = request.data;

        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        await this.usageQuotaPolicy.assertAndConsume(projectId);

        let _status = "pending";
        // Only set status for non-file data sources
        if (request.data.status && request.data.data.type !== 'files_local' && request.data.data.type !== 'files_s3') {
            _status = request.data.status;
        }

        return await this.dataSourcesRepository.create({
            ...request.data,
            status: _status as z.infer<typeof DataSource>['status'],
        });
    }
}