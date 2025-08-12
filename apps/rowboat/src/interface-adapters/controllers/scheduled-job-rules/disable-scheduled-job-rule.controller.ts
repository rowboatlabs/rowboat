import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IDisableScheduledJobRuleUseCase } from "@/src/application/use-cases/scheduled-job-rules/disable-scheduled-job-rule.use-case";
import { ScheduledJobRule } from "@/src/entities/models/scheduled-job-rule";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    ruleId: z.string(),
});

export interface IDisableScheduledJobRuleController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>>;
}

export class DisableScheduledJobRuleController implements IDisableScheduledJobRuleController {
    private readonly disableScheduledJobRuleUseCase: IDisableScheduledJobRuleUseCase;
    
    constructor({
        disableScheduledJobRuleUseCase,
    }: {
        disableScheduledJobRuleUseCase: IDisableScheduledJobRuleUseCase,
    }) {
        this.disableScheduledJobRuleUseCase = disableScheduledJobRuleUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, ruleId } = result.data;

        // execute use case
        return await this.disableScheduledJobRuleUseCase.execute({
            caller,
            userId,
            apiKey,
            ruleId,
        });
    }
}
