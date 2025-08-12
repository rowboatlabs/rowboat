import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListScheduledJobRulesUseCase } from "@/src/application/use-cases/scheduled-job-rules/list-scheduled-job-rules.use-case";
import { ScheduledJobRule } from "@/src/entities/models/scheduled-job-rule";
import { PaginatedList } from "@/src/entities/common/paginated-list";
import { ListedRuleItem } from "@/src/application/repositories/scheduled-job-rules.repository.interface";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    cursor: z.string().optional(),
    limit: z.number().optional(),
});

export interface IListScheduledJobRulesController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ListedRuleItem>>>>;
}

export class ListScheduledJobRulesController implements IListScheduledJobRulesController {
    private readonly listScheduledJobRulesUseCase: IListScheduledJobRulesUseCase;
    
    constructor({
        listScheduledJobRulesUseCase,
    }: {
        listScheduledJobRulesUseCase: IListScheduledJobRulesUseCase,
    }) {
        this.listScheduledJobRulesUseCase = listScheduledJobRulesUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ListedRuleItem>>>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, cursor, limit } = result.data;

        // execute use case
        return await this.listScheduledJobRulesUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            cursor,
            limit,
        });
    }
}
