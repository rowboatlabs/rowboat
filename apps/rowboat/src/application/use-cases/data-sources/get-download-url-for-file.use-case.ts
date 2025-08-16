import { z } from "zod";
import { IUploadsStorageService } from "@/src/application/services/uploads-storage.service.interface";
import { IDataSourceDocsRepository } from "@/src/application/repositories/data-source-docs.repository.interface";
import { IUsageQuotaPolicy } from "@/src/application/policies/usage-quota.policy.interface";
import { IProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";
import { NotFoundError } from "@/src/entities/errors/common";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    fileId: z.string(),
});

export interface IGetDownloadUrlForFileUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<string>;
}

export class GetDownloadUrlForFileUseCase implements IGetDownloadUrlForFileUseCase {
    private readonly s3UploadsStorageService: IUploadsStorageService;
    private readonly localUploadsStorageService: IUploadsStorageService;
    private readonly dataSourceDocsRepository: IDataSourceDocsRepository;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        s3UploadsStorageService,
        localUploadsStorageService,
        dataSourceDocsRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        s3UploadsStorageService: IUploadsStorageService,
        localUploadsStorageService: IUploadsStorageService,
        dataSourceDocsRepository: IDataSourceDocsRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.s3UploadsStorageService = s3UploadsStorageService;
        this.localUploadsStorageService = localUploadsStorageService;
        this.dataSourceDocsRepository = dataSourceDocsRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<string> {
        const { fileId } = request;

        const file = await this.dataSourceDocsRepository.fetch(fileId);
        if (!file) {
            throw new NotFoundError('File not found');
        }

        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId: file.projectId,
        });

        await this.usageQuotaPolicy.assertAndConsume(file.projectId);

        if (file.data.type === 'file_local') {
            return await this.localUploadsStorageService.getDownloadUrl(fileId);
        } else if (file.data.type === 'file_s3') {
            return await this.s3UploadsStorageService.getDownloadUrl(file.data.s3Key);
        }

        throw new NotFoundError('Invalid file type');
    }
}