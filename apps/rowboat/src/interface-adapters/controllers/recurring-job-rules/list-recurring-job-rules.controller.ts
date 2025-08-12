import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListRecurringJobRulesUseCase } from "@/src/application/use-cases/recurring-job-rules/list-recurring-job-rules.use-case";
import { PaginatedList } from "@/src/entities/common/paginated-list";
import { ListedRecurringRuleItem } from "@/src/application/repositories/recurring-job-rules.repository.interface";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    cursor: z.string().optional(),
    limit: z.number().optional(),
});

export interface IListRecurringJobRulesController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ListedRecurringRuleItem>>>>;
}

export class ListRecurringJobRulesController implements IListRecurringJobRulesController {
    private readonly listRecurringJobRulesUseCase: IListRecurringJobRulesUseCase;
    
    constructor({
        listRecurringJobRulesUseCase,
    }: {
        listRecurringJobRulesUseCase: IListRecurringJobRulesUseCase,
    }) {
        this.listRecurringJobRulesUseCase = listRecurringJobRulesUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ListedRecurringRuleItem>>>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, cursor, limit } = result.data;

        // execute use case
        return await this.listRecurringJobRulesUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            cursor,
            limit,
        });
    }
}
