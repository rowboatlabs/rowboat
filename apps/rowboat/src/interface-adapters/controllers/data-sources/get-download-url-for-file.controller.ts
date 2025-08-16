import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IGetDownloadUrlForFileUseCase } from "@/src/application/use-cases/data-sources/get-download-url-for-file.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    fileId: z.string(),
});

export interface IGetDownloadUrlForFileController {
    execute(request: z.infer<typeof inputSchema>): Promise<string>;
}

export class GetDownloadUrlForFileController implements IGetDownloadUrlForFileController {
    private readonly getDownloadUrlForFileUseCase: IGetDownloadUrlForFileUseCase;

    constructor({ getDownloadUrlForFileUseCase }: { getDownloadUrlForFileUseCase: IGetDownloadUrlForFileUseCase }) {
        this.getDownloadUrlForFileUseCase = getDownloadUrlForFileUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<string> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, fileId } = result.data;
        return await this.getDownloadUrlForFileUseCase.execute({ caller, userId, apiKey, fileId });
    }
}