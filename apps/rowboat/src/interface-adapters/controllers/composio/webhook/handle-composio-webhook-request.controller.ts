import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IHandleCompsioWebhookRequestUseCase } from "@/src/application/use-cases/composio/webhook/handle-composio-webhook-request.use-case";

const inputSchema = z.object({
    headers: z.record(z.string(), z.string()),
    payload: z.string(),
});

export interface IHandleComposioWebhookRequestController {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class HandleComposioWebhookRequestController implements IHandleComposioWebhookRequestController {
    private readonly handleCompsioWebhookRequestUseCase: IHandleCompsioWebhookRequestUseCase;
    
    constructor({
        handleCompsioWebhookRequestUseCase,
    }: {
        handleCompsioWebhookRequestUseCase: IHandleCompsioWebhookRequestUseCase,
    }) {
        this.handleCompsioWebhookRequestUseCase = handleCompsioWebhookRequestUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<void> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { headers, payload } = result.data;

        // execute use case
        return await this.handleCompsioWebhookRequestUseCase.execute({
            headers,
            payload,
        });
    }
}
