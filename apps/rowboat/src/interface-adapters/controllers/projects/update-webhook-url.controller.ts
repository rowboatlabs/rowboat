import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IUpdateWebhookUrlUseCase } from "@/src/application/use-cases/projects/update-webhook-url.use-case";
import { InputSchema } from "@/src/application/use-cases/projects/update-webhook-url.use-case";

export interface IUpdateWebhookUrlController {
    execute(request: z.infer<typeof InputSchema>): Promise<void>;
}

export class UpdateWebhookUrlController implements IUpdateWebhookUrlController {
    private readonly updateWebhookUrlUseCase: IUpdateWebhookUrlUseCase;
    
    constructor({
        updateWebhookUrlUseCase,
    }: {
        updateWebhookUrlUseCase: IUpdateWebhookUrlUseCase,
    }) {
        this.updateWebhookUrlUseCase = updateWebhookUrlUseCase;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<void> {
        // parse input
        const result = InputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        // execute use case
        return await this.updateWebhookUrlUseCase.execute(result.data);
    }
}
