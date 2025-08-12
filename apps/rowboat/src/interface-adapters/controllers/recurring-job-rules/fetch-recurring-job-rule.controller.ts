import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IFetchRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/fetch-recurring-job-rule.use-case";
import { RecurringJobRule } from "@/src/entities/models/recurring-job-rule";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    ruleId: z.string(),
});

export interface IFetchRecurringJobRuleController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof RecurringJobRule>>;
}

export class FetchRecurringJobRuleController implements IFetchRecurringJobRuleController {
    private readonly fetchRecurringJobRuleUseCase: IFetchRecurringJobRuleUseCase;
    
    constructor({
        fetchRecurringJobRuleUseCase,
    }: {
        fetchRecurringJobRuleUseCase: IFetchRecurringJobRuleUseCase,
    }) {
        this.fetchRecurringJobRuleUseCase = fetchRecurringJobRuleUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof RecurringJobRule>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, ruleId } = result.data;

        // execute use case
        return await this.fetchRecurringJobRuleUseCase.execute({
            caller,
            userId,
            apiKey,
            ruleId,
        });
    }
}
