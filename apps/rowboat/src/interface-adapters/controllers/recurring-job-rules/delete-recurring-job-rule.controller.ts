import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IDeleteRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/delete-recurring-job-rule.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    ruleId: z.string(),
});

export interface IDeleteRecurringJobRuleController {
    execute(request: z.infer<typeof inputSchema>): Promise<boolean>;
}

export class DeleteRecurringJobRuleController implements IDeleteRecurringJobRuleController {
    private readonly deleteRecurringJobRuleUseCase: IDeleteRecurringJobRuleUseCase;
    
    constructor({
        deleteRecurringJobRuleUseCase,
    }: {
        deleteRecurringJobRuleUseCase: IDeleteRecurringJobRuleUseCase,
    }) {
        this.deleteRecurringJobRuleUseCase = deleteRecurringJobRuleUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<boolean> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, ruleId } = result.data;

        // execute use case
        return await this.deleteRecurringJobRuleUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            ruleId,
        });
    }
}
