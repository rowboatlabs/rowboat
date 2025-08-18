import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IRemoveCustomMcpServerUseCase } from "@/src/application/use-cases/projects/remove-custom-mcp-server.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    name: z.string(),
});

export interface IRemoveCustomMcpServerController {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class RemoveCustomMcpServerController implements IRemoveCustomMcpServerController {
    private readonly removeCustomMcpServerUseCase: IRemoveCustomMcpServerUseCase;

    constructor({ removeCustomMcpServerUseCase }: { removeCustomMcpServerUseCase: IRemoveCustomMcpServerUseCase }) {
        this.removeCustomMcpServerUseCase = removeCustomMcpServerUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<void> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.removeCustomMcpServerUseCase.execute(result.data);
    }
}


