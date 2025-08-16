import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IGetUploadUrlsForFilesUseCase } from "@/src/application/use-cases/data-sources/get-upload-urls-for-files.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    sourceId: z.string(),
    files: z.array(z.object({ name: z.string(), type: z.string(), size: z.number() })),
});

export interface IGetUploadUrlsForFilesController {
    execute(request: z.infer<typeof inputSchema>): Promise<{ fileId: string, uploadUrl: string, path: string }[]>;
}

export class GetUploadUrlsForFilesController implements IGetUploadUrlsForFilesController {
    private readonly getUploadUrlsForFilesUseCase: IGetUploadUrlsForFilesUseCase;

    constructor({ getUploadUrlsForFilesUseCase }: { getUploadUrlsForFilesUseCase: IGetUploadUrlsForFilesUseCase }) {
        this.getUploadUrlsForFilesUseCase = getUploadUrlsForFilesUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<{ fileId: string, uploadUrl: string, path: string }[]> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, sourceId, files } = result.data;
        return await this.getUploadUrlsForFilesUseCase.execute({ caller, userId, apiKey, sourceId, files });
    }
}