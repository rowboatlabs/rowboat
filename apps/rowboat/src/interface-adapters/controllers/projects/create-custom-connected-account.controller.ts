import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { ICreateCustomConnectedAccountUseCase } from "@/src/application/use-cases/projects/create-custom-connected-account.use-case";
import { ZAuthScheme, ZCredentials, ZCreateConnectedAccountResponse } from "@/app/lib/composio/composio";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
    authConfig: z.object({
        authScheme: ZAuthScheme,
        credentials: ZCredentials,
    }),
    callbackUrl: z.string(),
});

export interface ICreateCustomConnectedAccountController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>>;
}

export class CreateCustomConnectedAccountController implements ICreateCustomConnectedAccountController {
    private readonly createCustomConnectedAccountUseCase: ICreateCustomConnectedAccountUseCase;

    constructor({ createCustomConnectedAccountUseCase }: { createCustomConnectedAccountUseCase: ICreateCustomConnectedAccountUseCase }) {
        this.createCustomConnectedAccountUseCase = createCustomConnectedAccountUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.createCustomConnectedAccountUseCase.execute(result.data);
    }
}


