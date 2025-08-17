import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListComposioToolkitsUseCase } from "@/src/application/use-cases/projects/list-composio-toolkits.use-case";
import { ZToolkit, ZListResponse } from "@/app/lib/composio/composio";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    cursor: z.string().nullable().optional(),
});

export interface IListComposioToolkitsController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>>;
}

export class ListComposioToolkitsController implements IListComposioToolkitsController {
    private readonly listComposioToolkitsUseCase: IListComposioToolkitsUseCase;

    constructor({ listComposioToolkitsUseCase }: { listComposioToolkitsUseCase: IListComposioToolkitsUseCase }) {
        this.listComposioToolkitsUseCase = listComposioToolkitsUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.listComposioToolkitsUseCase.execute(result.data);
    }
}


