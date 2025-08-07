import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { ICreateComposioTriggerDeploymentUseCase } from "@/src/application/use-cases/composio-trigger-deployments/create-composio-trigger-deployment.use-case";
import { ComposioTriggerDeployment } from "@/src/entities/models/composio-trigger-deployment";
import { CreateDeploymentSchema } from "@/src/application/repositories/composio-trigger-deployments.repository.interface";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    data: CreateDeploymentSchema.omit({
        triggerId: true,
        logo: true,
    }),
});

export interface ICreateComposioTriggerDeploymentController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ComposioTriggerDeployment>>;
}

export class CreateComposioTriggerDeploymentController implements ICreateComposioTriggerDeploymentController {
    private readonly createComposioTriggerDeploymentUseCase: ICreateComposioTriggerDeploymentUseCase;
    
    constructor({
        createComposioTriggerDeploymentUseCase,
    }: {
        createComposioTriggerDeploymentUseCase: ICreateComposioTriggerDeploymentUseCase,
    }) {
        this.createComposioTriggerDeploymentUseCase = createComposioTriggerDeploymentUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ComposioTriggerDeployment>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, data } = result.data;

        // execute use case
        return await this.createComposioTriggerDeploymentUseCase.execute({
            caller,
            userId,
            apiKey,
            data,
        });
    }
}
