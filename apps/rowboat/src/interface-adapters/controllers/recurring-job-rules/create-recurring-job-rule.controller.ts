import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { ICreateRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/create-recurring-job-rule.use-case";
import { RecurringJobRule } from "@/src/entities/models/recurring-job-rule";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    input: z.object({
        messages: z.array(z.any()),
    }),
    cron: z.string(),
});

export interface ICreateRecurringJobRuleController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof RecurringJobRule>>;
}

export class CreateRecurringJobRuleController implements ICreateRecurringJobRuleController {
    private readonly createRecurringJobRuleUseCase: ICreateRecurringJobRuleUseCase;
    
    constructor({
        createRecurringJobRuleUseCase,
    }: {
        createRecurringJobRuleUseCase: ICreateRecurringJobRuleUseCase,
    }) {
        this.createRecurringJobRuleUseCase = createRecurringJobRuleUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof RecurringJobRule>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, input, cron } = result.data;

        // execute use case
        return await this.createRecurringJobRuleUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            input,
            cron,
        });
    }
}
