import { z } from "zod";
import { CopilotStreamEvent } from '@/src/entities/models/copilot';
import { IRunCopilotCachedTurnUseCase } from "@/src/application/use-cases/copilot/run-copilot-cached-turn.use-case";
import { BadRequestError } from "@/src/entities/errors/common";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    key: z.string(),
});

export interface IRunCopilotCachedTurnController {
    execute(request: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof CopilotStreamEvent>, void, unknown>;
}

export class RunCopilotCachedTurnController implements IRunCopilotCachedTurnController {
    private readonly runCopilotCachedTurnUseCase: IRunCopilotCachedTurnUseCase;

    constructor({
        runCopilotCachedTurnUseCase,
    }: {
        runCopilotCachedTurnUseCase: IRunCopilotCachedTurnUseCase,
    }) {
        this.runCopilotCachedTurnUseCase = runCopilotCachedTurnUseCase;
    }

    async *execute(request: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof CopilotStreamEvent>, void, unknown> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }

        yield *this.runCopilotCachedTurnUseCase.execute(result.data);
    }
}