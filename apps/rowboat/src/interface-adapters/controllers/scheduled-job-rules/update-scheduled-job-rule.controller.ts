import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IUpdateScheduledJobRuleUseCase } from "@/src/application/use-cases/scheduled-job-rules/update-scheduled-job-rule.use-case";
import { ScheduledJobRule } from "@/src/entities/models/scheduled-job-rule";
import { Message } from "@/app/lib/types/types";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    ruleId: z.string(),
    input: z.object({
        messages: z.array(Message),
    }),
    scheduledTime: z.string().datetime(),
});

export interface IUpdateScheduledJobRuleController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>>;
}

export class UpdateScheduledJobRuleController implements IUpdateScheduledJobRuleController {
    private readonly updateScheduledJobRuleUseCase: IUpdateScheduledJobRuleUseCase;
    
    constructor({
        updateScheduledJobRuleUseCase,
    }: {
        updateScheduledJobRuleUseCase: IUpdateScheduledJobRuleUseCase,
    }) {
        this.updateScheduledJobRuleUseCase = updateScheduledJobRuleUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, ruleId, input, scheduledTime } = result.data;

        return await this.updateScheduledJobRuleUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            ruleId,
            input,
            scheduledTime,
        });
    }
}
