import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IAddCustomMcpServerUseCase } from "@/src/application/use-cases/projects/add-custom-mcp-server.use-case";
import { CustomMcpServer } from "@/src/entities/models/project";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    name: z.string(),
    server: CustomMcpServer,
});

export interface IAddCustomMcpServerController {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class AddCustomMcpServerController implements IAddCustomMcpServerController {
    private readonly addCustomMcpServerUseCase: IAddCustomMcpServerUseCase;

    constructor({ addCustomMcpServerUseCase }: { addCustomMcpServerUseCase: IAddCustomMcpServerUseCase }) {
        this.addCustomMcpServerUseCase = addCustomMcpServerUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<void> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.addCustomMcpServerUseCase.execute(result.data);
    }
}


