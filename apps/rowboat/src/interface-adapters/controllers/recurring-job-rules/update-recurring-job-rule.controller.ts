import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IUpdateRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/update-recurring-job-rule.use-case";
import { RecurringJobRule } from "@/src/entities/models/recurring-job-rule";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    ruleId: z.string(),
    input: z.object({
        messages: z.array(z.any()),
    }),
    cron: z.string(),
});

export interface IUpdateRecurringJobRuleController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof RecurringJobRule>>;
}

export class UpdateRecurringJobRuleController implements IUpdateRecurringJobRuleController {
    private readonly updateRecurringJobRuleUseCase: IUpdateRecurringJobRuleUseCase;
    
    constructor({
        updateRecurringJobRuleUseCase,
    }: {
        updateRecurringJobRuleUseCase: IUpdateRecurringJobRuleUseCase,
    }) {
        this.updateRecurringJobRuleUseCase = updateRecurringJobRuleUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof RecurringJobRule>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, ruleId, input, cron } = result.data;

        return await this.updateRecurringJobRuleUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            ruleId,
            input,
            cron,
        });
    }
}
