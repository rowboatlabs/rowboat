import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IDeleteComposioTriggerDeploymentUseCase } from "@/src/application/use-cases/composio-trigger-deployments/delete-composio-trigger-deployment.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    deploymentId: z.string(),
});

export interface IDeleteComposioTriggerDeploymentController {
    execute(request: z.infer<typeof inputSchema>): Promise<boolean>;
}

export class DeleteComposioTriggerDeploymentController implements IDeleteComposioTriggerDeploymentController {
    private readonly deleteComposioTriggerDeploymentUseCase: IDeleteComposioTriggerDeploymentUseCase;
    
    constructor({
        deleteComposioTriggerDeploymentUseCase,
    }: {
        deleteComposioTriggerDeploymentUseCase: IDeleteComposioTriggerDeploymentUseCase,
    }) {
        this.deleteComposioTriggerDeploymentUseCase = deleteComposioTriggerDeploymentUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<boolean> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, deploymentId } = result.data;

        // execute use case
        return await this.deleteComposioTriggerDeploymentUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            deploymentId,
        });
    }
}
