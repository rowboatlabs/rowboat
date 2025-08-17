import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IRevertToLiveWorkflowUseCase } from "@/src/application/use-cases/projects/revert-to-live-workflow.use-case";
import { InputSchema } from "@/src/application/use-cases/projects/revert-to-live-workflow.use-case";

export interface IRevertToLiveWorkflowController {
    execute(request: z.infer<typeof InputSchema>): Promise<void>;
}

export class RevertToLiveWorkflowController implements IRevertToLiveWorkflowController {
    private readonly revertToLiveWorkflowUseCase: IRevertToLiveWorkflowUseCase;

    constructor({ revertToLiveWorkflowUseCase }: { revertToLiveWorkflowUseCase: IRevertToLiveWorkflowUseCase }) {
        this.revertToLiveWorkflowUseCase = revertToLiveWorkflowUseCase;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<void> {
        const result = InputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.revertToLiveWorkflowUseCase.execute(result.data);
    }
}
