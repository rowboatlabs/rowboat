import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IUpdateDraftWorkflowUseCase } from "@/src/application/use-cases/projects/update-draft-workflow.use-case";
import { InputSchema } from "@/src/application/use-cases/projects/update-draft-workflow.use-case";

export interface IUpdateDraftWorkflowController {
    execute(request: z.infer<typeof InputSchema>): Promise<void>;
}

export class UpdateDraftWorkflowController implements IUpdateDraftWorkflowController {
    private readonly updateDraftWorkflowUseCase: IUpdateDraftWorkflowUseCase;

    constructor({ updateDraftWorkflowUseCase }: { updateDraftWorkflowUseCase: IUpdateDraftWorkflowUseCase }) {
        this.updateDraftWorkflowUseCase = updateDraftWorkflowUseCase;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<void> {
        const result = InputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.updateDraftWorkflowUseCase.execute(result.data);
    }
}
