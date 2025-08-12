import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IEnableScheduledJobRuleUseCase } from "@/src/application/use-cases/scheduled-job-rules/enable-scheduled-job-rule.use-case";
import { ScheduledJobRule } from "@/src/entities/models/scheduled-job-rule";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    ruleId: z.string(),
});

export interface IEnableScheduledJobRuleController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>>;
}

export class EnableScheduledJobRuleController implements IEnableScheduledJobRuleController {
    private readonly enableScheduledJobRuleUseCase: IEnableScheduledJobRuleUseCase;
    
    constructor({
        enableScheduledJobRuleUseCase,
    }: {
        enableScheduledJobRuleUseCase: IEnableScheduledJobRuleUseCase,
    }) {
        this.enableScheduledJobRuleUseCase = enableScheduledJobRuleUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, ruleId } = result.data;

        // execute use case
        return await this.enableScheduledJobRuleUseCase.execute({
            caller,
            userId,
            apiKey,
            ruleId,
        });
    }
}
