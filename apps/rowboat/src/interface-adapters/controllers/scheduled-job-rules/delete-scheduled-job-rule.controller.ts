import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IDeleteScheduledJobRuleUseCase } from "@/src/application/use-cases/scheduled-job-rules/delete-scheduled-job-rule.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    ruleId: z.string(),
});

export interface IDeleteScheduledJobRuleController {
    execute(request: z.infer<typeof inputSchema>): Promise<boolean>;
}

export class DeleteScheduledJobRuleController implements IDeleteScheduledJobRuleController {
    private readonly deleteScheduledJobRuleUseCase: IDeleteScheduledJobRuleUseCase;
    
    constructor({
        deleteScheduledJobRuleUseCase,
    }: {
        deleteScheduledJobRuleUseCase: IDeleteScheduledJobRuleUseCase,
    }) {
        this.deleteScheduledJobRuleUseCase = deleteScheduledJobRuleUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<boolean> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, ruleId } = result.data;

        // execute use case
        return await this.deleteScheduledJobRuleUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            ruleId,
        });
    }
}
