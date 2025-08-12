import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { ICreateScheduledJobRuleUseCase } from "@/src/application/use-cases/scheduled-job-rules/create-scheduled-job-rule.use-case";
import { ScheduledJobRule } from "@/src/entities/models/scheduled-job-rule";
import { Message } from "@/app/lib/types/types";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    input: z.object({
        messages: z.array(Message),
    }),
    scheduledTime: z.string().datetime(),
});

export interface ICreateScheduledJobRuleController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>>;
}

export class CreateScheduledJobRuleController implements ICreateScheduledJobRuleController {
    private readonly createScheduledJobRuleUseCase: ICreateScheduledJobRuleUseCase;
    
    constructor({
        createScheduledJobRuleUseCase,
    }: {
        createScheduledJobRuleUseCase: ICreateScheduledJobRuleUseCase,
    }) {
        this.createScheduledJobRuleUseCase = createScheduledJobRuleUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, input, scheduledTime } = result.data;

        // execute use case
        return await this.createScheduledJobRuleUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            input,
            scheduledTime,
        });
    }
}
