import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { ISyncConnectedAccountUseCase } from "@/src/application/use-cases/projects/sync-connected-account.use-case";
import { ComposioConnectedAccount } from "@/src/entities/models/project";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
    connectedAccountId: z.string(),
});

export interface ISyncConnectedAccountController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ComposioConnectedAccount>>;
}

export class SyncConnectedAccountController implements ISyncConnectedAccountController {
    private readonly syncConnectedAccountUseCase: ISyncConnectedAccountUseCase;

    constructor({ syncConnectedAccountUseCase }: { syncConnectedAccountUseCase: ISyncConnectedAccountUseCase }) {
        this.syncConnectedAccountUseCase = syncConnectedAccountUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ComposioConnectedAccount>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.syncConnectedAccountUseCase.execute(result.data);
    }
}


