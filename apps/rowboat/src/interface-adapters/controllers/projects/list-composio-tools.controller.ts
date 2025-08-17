import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListComposioToolsUseCase } from "@/src/application/use-cases/projects/list-composio-tools.use-case";
import { ZTool, ZListResponse } from "@/app/lib/composio/composio";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
    searchQuery: z.string().nullable().optional(),
    cursor: z.string().nullable().optional(),
});

export interface IListComposioToolsController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>>;
}

export class ListComposioToolsController implements IListComposioToolsController {
    private readonly listComposioToolsUseCase: IListComposioToolsUseCase;

    constructor({ listComposioToolsUseCase }: { listComposioToolsUseCase: IListComposioToolsUseCase }) {
        this.listComposioToolsUseCase = listComposioToolsUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.listComposioToolsUseCase.execute(result.data);
    }
}


