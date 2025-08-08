import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListComposioTriggerTypesUseCase } from "@/src/application/use-cases/composio-trigger-deployments/list-composio-trigger-types.use-case";
import { ComposioTriggerType } from "@/src/entities/models/composio-trigger-type";
import { PaginatedList } from "@/src/entities/common/paginated-list";

const inputSchema = z.object({
    toolkitSlug: z.string(),
    cursor: z.string().optional(),
});

export interface IListComposioTriggerTypesController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ComposioTriggerType>>>>;
}

export class ListComposioTriggerTypesController implements IListComposioTriggerTypesController {
    private readonly listComposioTriggerTypesUseCase: IListComposioTriggerTypesUseCase;
    
    constructor({
        listComposioTriggerTypesUseCase,
    }: {
        listComposioTriggerTypesUseCase: IListComposioTriggerTypesUseCase,
    }) {
        this.listComposioTriggerTypesUseCase = listComposioTriggerTypesUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ComposioTriggerType>>>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { toolkitSlug, cursor } = result.data;

        // execute use case
        return await this.listComposioTriggerTypesUseCase.execute({
            toolkitSlug,
            cursor,
        });
    }
}
