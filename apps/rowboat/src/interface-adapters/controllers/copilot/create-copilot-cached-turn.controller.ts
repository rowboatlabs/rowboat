import { z } from "zod";
import { CopilotChatContext, CopilotMessage, DataSourceSchemaForCopilot } from '@/src/entities/models/copilot';
import { Workflow } from '@/app/lib/types/workflow_types';
import { ICreateCopilotCachedTurnUseCase } from "@/src/application/use-cases/copilot/create-copilot-cached-turn.use-case";
import { BadRequestError } from "@/src/entities/errors/common";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    data: z.object({
        projectId: z.string(),
        messages: z.array(CopilotMessage),
        workflow: Workflow,
        context: CopilotChatContext.nullable(),
        dataSources: z.array(DataSourceSchemaForCopilot).optional(),
    }),
});

export interface ICreateCopilotCachedTurnController {
    execute(request: z.infer<typeof inputSchema>): Promise<{ key: string }>;
}

export class CreateCopilotCachedTurnController implements ICreateCopilotCachedTurnController {
    private readonly createCopilotCachedTurnUseCase: ICreateCopilotCachedTurnUseCase;

    constructor({
        createCopilotCachedTurnUseCase,
    }: {
        createCopilotCachedTurnUseCase: ICreateCopilotCachedTurnUseCase,
    }) {
        this.createCopilotCachedTurnUseCase = createCopilotCachedTurnUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<{ key: string }> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }

        return await this.createCopilotCachedTurnUseCase.execute(result.data);
    }
}