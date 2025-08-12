import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IFetchScheduledJobRuleUseCase } from "@/src/application/use-cases/scheduled-job-rules/fetch-scheduled-job-rule.use-case";
import { ScheduledJobRule } from "@/src/entities/models/scheduled-job-rule";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    ruleId: z.string(),
});

export interface IFetchScheduledJobRuleController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>>;
}

export class FetchScheduledJobRuleController implements IFetchScheduledJobRuleController {
    private readonly fetchScheduledJobRuleUseCase: IFetchScheduledJobRuleUseCase;
    
    constructor({
        fetchScheduledJobRuleUseCase,
    }: {
        fetchScheduledJobRuleUseCase: IFetchScheduledJobRuleUseCase,
    }) {
        this.fetchScheduledJobRuleUseCase = fetchScheduledJobRuleUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, ruleId } = result.data;

        // execute use case
        return await this.fetchScheduledJobRuleUseCase.execute({
            caller,
            userId,
            apiKey,
            ruleId,
        });
    }
}
