import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListComposioTriggerDeploymentsUseCase } from "@/src/application/use-cases/composio-trigger-deployments/list-composio-trigger-deployments.use-case";
import { ComposioTriggerDeployment } from "@/src/entities/models/composio-trigger-deployment";
import { PaginatedList } from "@/src/entities/common/paginated-list";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    cursor: z.string().optional(),
    limit: z.number().optional(),
});

export interface IListComposioTriggerDeploymentsController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ComposioTriggerDeployment>>>>;
}

export class ListComposioTriggerDeploymentsController implements IListComposioTriggerDeploymentsController {
    private readonly listComposioTriggerDeploymentsUseCase: IListComposioTriggerDeploymentsUseCase;
    
    constructor({
        listComposioTriggerDeploymentsUseCase,
    }: {
        listComposioTriggerDeploymentsUseCase: IListComposioTriggerDeploymentsUseCase,
    }) {
        this.listComposioTriggerDeploymentsUseCase = listComposioTriggerDeploymentsUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ComposioTriggerDeployment>>>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, cursor, limit } = result.data;

        // execute use case
        return await this.listComposioTriggerDeploymentsUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            cursor,
            limit,
        });
    }
}
