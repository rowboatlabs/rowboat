import { z } from "zod";
import { IUploadsStorageService } from "@/src/application/services/uploads-storage.service.interface";
import { IDataSourcesRepository } from "@/src/application/repositories/data-sources.repository.interface";
import { IUsageQuotaPolicy } from "@/src/application/policies/usage-quota.policy.interface";
import { IProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";
import { ObjectId } from "mongodb";
import { NotFoundError } from "@/src/entities/errors/common";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    sourceId: z.string(),
    files: z.array(z.object({ name: z.string(), type: z.string(), size: z.number() })),
});

export interface IGetUploadUrlsForFilesUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<{ fileId: string, uploadUrl: string, path: string }[]>;
}

export class GetUploadUrlsForFilesUseCase implements IGetUploadUrlsForFilesUseCase {
    private readonly s3UploadsStorageService: IUploadsStorageService;
    private readonly localUploadsStorageService: IUploadsStorageService;
    private readonly dataSourcesRepository: IDataSourcesRepository;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        s3UploadsStorageService,
        localUploadsStorageService,
        dataSourcesRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        s3UploadsStorageService: IUploadsStorageService,
        localUploadsStorageService: IUploadsStorageService,
        dataSourcesRepository: IDataSourcesRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.s3UploadsStorageService = s3UploadsStorageService;
        this.localUploadsStorageService = localUploadsStorageService;
        this.dataSourcesRepository = dataSourcesRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<{ fileId: string, uploadUrl: string, path: string }[]> {
        const { sourceId, files } = request;

        const source = await this.dataSourcesRepository.fetch(sourceId);
        if (!source) {
            throw new NotFoundError('Data source not found');
        }

        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId: source.projectId,
        });

        await this.usageQuotaPolicy.assertAndConsume(source.projectId);

        const urls: { fileId: string, uploadUrl: string, path: string }[] = [];
        for (const file of files) {
            const fileId = new ObjectId().toString();

            if (source.data.type === 'files_s3') {
                const projectIdPrefix = source.projectId.slice(0, 2);
                const path = `datasources/files/${projectIdPrefix}/${source.projectId}/${sourceId}/${fileId}/${file.name}`;
                const uploadUrl = await this.s3UploadsStorageService.getUploadUrl(path, file.type);
                urls.push({ fileId, uploadUrl, path });
            } else if (source.data.type === 'files_local') {
                const uploadUrl = await this.localUploadsStorageService.getUploadUrl(fileId, file.type);
                urls.push({ fileId, uploadUrl, path: uploadUrl });
            }
        }

        return urls;
    }
}