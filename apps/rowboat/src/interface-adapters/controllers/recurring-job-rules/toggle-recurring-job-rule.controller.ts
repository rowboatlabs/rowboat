import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IToggleRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/toggle-recurring-job-rule.use-case";
import { RecurringJobRule } from "@/src/entities/models/recurring-job-rule";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    ruleId: z.string(),
    disabled: z.boolean(),
});

export interface IToggleRecurringJobRuleController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof RecurringJobRule>>;
}

export class ToggleRecurringJobRuleController implements IToggleRecurringJobRuleController {
    private readonly toggleRecurringJobRuleUseCase: IToggleRecurringJobRuleUseCase;
    
    constructor({
        toggleRecurringJobRuleUseCase,
    }: {
        toggleRecurringJobRuleUseCase: IToggleRecurringJobRuleUseCase,
    }) {
        this.toggleRecurringJobRuleUseCase = toggleRecurringJobRuleUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof RecurringJobRule>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, ruleId, disabled } = result.data;

        // execute use case
        return await this.toggleRecurringJobRuleUseCase.execute({
            caller,
            userId,
            apiKey,
            ruleId,
            disabled,
        });
    }
}
