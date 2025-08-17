import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IUpdateProjectNameUseCase } from "@/src/application/use-cases/projects/update-project-name.use-case";
import { InputSchema } from "@/src/application/use-cases/projects/update-project-name.use-case";

export interface IUpdateProjectNameController {
    execute(request: z.infer<typeof InputSchema>): Promise<void>;
}

export class UpdateProjectNameController implements IUpdateProjectNameController {
    private readonly updateProjectNameUseCase: IUpdateProjectNameUseCase;
    
    constructor({
        updateProjectNameUseCase,
    }: {
        updateProjectNameUseCase: IUpdateProjectNameUseCase,
    }) {
        this.updateProjectNameUseCase = updateProjectNameUseCase;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<void> {
        // parse input
        const result = InputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        // execute use case
        return await this.updateProjectNameUseCase.execute(result.data);
    }
}
