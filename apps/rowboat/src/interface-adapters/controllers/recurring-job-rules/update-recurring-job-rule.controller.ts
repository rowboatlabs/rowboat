import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IUpdateRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/update-recurring-job-rule.use-case";
import { RecurringJobRule } from "@/src/entities/models/recurring-job-rule";
import { UpdateRecurringRuleSchema } from "@/src/application/repositories/recurring-job-rules.repository.interface";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    ruleId: z.string(),
    data: UpdateRecurringRuleSchema,
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
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, ruleId, data } = result.data;

        // execute use case
        return await this.updateRecurringJobRuleUseCase.execute({
            caller,
            userId,
            apiKey,
            ruleId,
            data,
        });
    }
}
