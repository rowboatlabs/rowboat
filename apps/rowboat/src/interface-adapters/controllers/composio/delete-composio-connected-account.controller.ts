import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IDeleteComposioConnectedAccountUseCase } from "@/src/application/use-cases/composio/delete-composio-connected-account.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
    connectedAccountId: z.string(),
});

export interface IDeleteComposioConnectedAccountController {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class DeleteComposioConnectedAccountController implements IDeleteComposioConnectedAccountController {
    private readonly deleteComposioConnectedAccountUseCase: IDeleteComposioConnectedAccountUseCase;
    
    constructor({
        deleteComposioConnectedAccountUseCase,
    }: {
        deleteComposioConnectedAccountUseCase: IDeleteComposioConnectedAccountUseCase,
    }) {
        this.deleteComposioConnectedAccountUseCase = deleteComposioConnectedAccountUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<void> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, toolkitSlug, connectedAccountId } = result.data;

        // execute use case
        return await this.deleteComposioConnectedAccountUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            toolkitSlug,
            connectedAccountId,
        });
    }
}
