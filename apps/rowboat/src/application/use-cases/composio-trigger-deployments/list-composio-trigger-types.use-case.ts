import { z } from "zod";
import { listTriggersTypes } from '../../../../app/lib/composio/composio';
import { PaginatedList } from '@/src/entities/common/paginated-list';
import { ComposioTriggerType } from '@/src/entities/models/composio-trigger-type';

const inputSchema = z.object({
    toolkitSlug: z.string(),
    cursor: z.string().optional(),
});

export interface IListComposioTriggerTypesUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ComposioTriggerType>>>>;
}

export class ListComposioTriggerTypesUseCase implements IListComposioTriggerTypesUseCase {
    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ComposioTriggerType>>>> {
        // call composio api to fetch trigger types
        const result = await listTriggersTypes(request.toolkitSlug, request.cursor);

        // return paginated list of trigger types
        return {
            items: result.items,
            nextCursor: result.next_cursor,
        };
    }
}