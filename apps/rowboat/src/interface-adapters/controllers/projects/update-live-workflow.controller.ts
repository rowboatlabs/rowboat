import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IUpdateLiveWorkflowUseCase } from "@/src/application/use-cases/projects/update-live-workflow.use-case";
import { InputSchema } from "@/src/application/use-cases/projects/update-live-workflow.use-case";

export interface IUpdateLiveWorkflowController {
    execute(request: z.infer<typeof InputSchema>): Promise<void>;
}

export class UpdateLiveWorkflowController implements IUpdateLiveWorkflowController {
    private readonly updateLiveWorkflowUseCase: IUpdateLiveWorkflowUseCase;

    constructor({ updateLiveWorkflowUseCase }: { updateLiveWorkflowUseCase: IUpdateLiveWorkflowUseCase }) {
        this.updateLiveWorkflowUseCase = updateLiveWorkflowUseCase;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<void> {
        const result = InputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.updateLiveWorkflowUseCase.execute(result.data);
    }
}
