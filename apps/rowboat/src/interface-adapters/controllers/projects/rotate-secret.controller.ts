import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IRotateSecretUseCase } from "@/src/application/use-cases/projects/rotate-secret.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string(),
    apiKey: z.string().optional(),
    projectId: z.string(),
});

export interface IRotateSecretController {
    execute(request: z.infer<typeof inputSchema>): Promise<string>;
}

export class RotateSecretController implements IRotateSecretController {
    private readonly rotateSecretUseCase: IRotateSecretUseCase;
    
    constructor({
        rotateSecretUseCase,
    }: {
        rotateSecretUseCase: IRotateSecretUseCase,
    }) {
        this.rotateSecretUseCase = rotateSecretUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<string> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }

        // execute use case
        return await this.rotateSecretUseCase.execute(request);
    }
}
