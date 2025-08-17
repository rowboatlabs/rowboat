import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IDeleteProjectUseCase } from "@/src/application/use-cases/projects/delete-project.use-case";
import { InputSchema } from "@/src/application/use-cases/projects/delete-project.use-case";

export interface IDeleteProjectController {
    execute(request: z.infer<typeof InputSchema>): Promise<void>;
}

export class DeleteProjectController implements IDeleteProjectController {
    private readonly deleteProjectUseCase: IDeleteProjectUseCase;
    
    constructor({
        deleteProjectUseCase,
    }: {
        deleteProjectUseCase: IDeleteProjectUseCase,
    }) {
        this.deleteProjectUseCase = deleteProjectUseCase;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<void> {
        // parse input
        const result = InputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        // execute use case
        return await this.deleteProjectUseCase.execute(result.data);
    }
}
