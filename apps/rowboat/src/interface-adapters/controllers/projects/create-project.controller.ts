import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { ICreateProjectUseCase, InputSchema } from "@/src/application/use-cases/projects/create-project.use-case";
import { Project } from "@/src/entities/models/project";

export interface ICreateProjectController {
    execute(request: z.infer<typeof InputSchema>): Promise<z.infer<typeof Project>>;
}

export class CreateProjectController implements ICreateProjectController {
    private readonly createProjectUseCase: ICreateProjectUseCase;
    
    constructor({
        createProjectUseCase,
    }: {
        createProjectUseCase: ICreateProjectUseCase,
    }) {
        this.createProjectUseCase = createProjectUseCase;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<z.infer<typeof Project>> {
        // parse input
        const result = InputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { userId, data } = result.data;

        // execute use case
        return await this.createProjectUseCase.execute({
            userId,
            data,
        });
    }
}
