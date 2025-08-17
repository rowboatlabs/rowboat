import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IGetComposioToolkitUseCase } from "@/src/application/use-cases/projects/get-composio-toolkit.use-case";
import { ZGetToolkitResponse } from "@/app/lib/composio/composio";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
});

export interface IGetComposioToolkitController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ZGetToolkitResponse>>;
}

export class GetComposioToolkitController implements IGetComposioToolkitController {
    private readonly getComposioToolkitUseCase: IGetComposioToolkitUseCase;

    constructor({ getComposioToolkitUseCase }: { getComposioToolkitUseCase: IGetComposioToolkitUseCase }) {
        this.getComposioToolkitUseCase = getComposioToolkitUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ZGetToolkitResponse>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.getComposioToolkitUseCase.execute(result.data);
    }
}


