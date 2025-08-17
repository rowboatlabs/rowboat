import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { ICreateComposioManagedConnectedAccountUseCase } from "@/src/application/use-cases/projects/create-composio-managed-connected-account.use-case";
import { ZCreateConnectedAccountResponse } from "@/app/lib/composio/composio";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
    callbackUrl: z.string(),
});

export interface ICreateComposioManagedConnectedAccountController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>>;
}

export class CreateComposioManagedConnectedAccountController implements ICreateComposioManagedConnectedAccountController {
    private readonly createComposioManagedConnectedAccountUseCase: ICreateComposioManagedConnectedAccountUseCase;

    constructor({ createComposioManagedConnectedAccountUseCase }: { createComposioManagedConnectedAccountUseCase: ICreateComposioManagedConnectedAccountUseCase }) {
        this.createComposioManagedConnectedAccountUseCase = createComposioManagedConnectedAccountUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.createComposioManagedConnectedAccountUseCase.execute(result.data);
    }
}


