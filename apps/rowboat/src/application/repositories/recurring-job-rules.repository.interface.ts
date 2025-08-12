import { NotFoundError } from "@/src/entities/errors/common";
import { z } from "zod";
import { PaginatedList } from "@/src/entities/common/paginated-list";
import { RecurringJobRule } from "@/src/entities/models/recurring-job-rule";

/**
 * Schema for creating a new recurring job rule.
 */
export const CreateRecurringRuleSchema = RecurringJobRule
    .pick({
        projectId: true,
        input: true,
        cron: true,
    });

export const ListedRecurringRuleItem = RecurringJobRule.omit({
    input: true,
});

export const UpdateRecurringRuleSchema = RecurringJobRule.pick({
    disabled: true,
    lastError: true,
});

/**
 * Repository interface for managing recurring job rules in the system.
 * 
 * This interface defines the contract for recurring job rule management operations including
 * creation, fetching, polling, processing, and listing rules. Recurring job rules represent
 * tasks that can be processed by workers based on cron expressions.
 */
export interface IRecurringJobRulesRepository {
    /**
     * Creates a new recurring job rule in the system.
     * 
     * @param data - The rule data containing project ID, input messages, and cron expression
     * @returns Promise resolving to the created recurring job rule with all fields populated
     */
    create(data: z.infer<typeof CreateRecurringRuleSchema>): Promise<z.infer<typeof RecurringJobRule>>;

    /**
     * Fetches a recurring job rule by its unique identifier.
     * 
     * @param id - The unique identifier of the recurring job rule to fetch
     * @returns Promise resolving to the recurring job rule or null if not found
     */
    fetch(id: string): Promise<z.infer<typeof RecurringJobRule> | null>;

    /**
     * Polls for the next available recurring job rule that can be processed by a worker.
     * 
     * This method should return the next rule that is ready to be processed (not disabled,
     * not currently locked, and nextRunAt is in the past).
     * 
     * @param workerId - The unique identifier of the worker requesting a recurring job rule
     * @returns Promise resolving to the next available recurring job rule or null if no rules are available
     */
    poll(workerId: string): Promise<z.infer<typeof RecurringJobRule> | null>;

    /**
     * Updates a recurring job rule with new data.
     * 
     * @param id - The unique identifier of the recurring job rule to update
     * @param data - The update data
     * @returns Promise resolving to the updated recurring job rule
     * @throws {NotFoundError} if the recurring job rule doesn't exist
     */
    update(id: string, data: z.infer<typeof UpdateRecurringRuleSchema>): Promise<z.infer<typeof RecurringJobRule>>;

    /**
     * Releases a recurring job rule after it has been executed and sets the next run time.
     * 
     * @param id - The unique identifier of the recurring job rule to release
     * @param nextRunAt - The next time this rule should run
     * @returns Promise resolving to the updated recurring job rule
     * @throws {NotFoundError} if the recurring job rule doesn't exist
     */
    release(id: string, nextRunAt: string): Promise<z.infer<typeof RecurringJobRule>>;

    /**
     * Lists recurring job rules for a specific project with pagination.
     * 
     * @param projectId - The unique identifier of the project
     * @param cursor - Optional cursor for pagination
     * @param limit - Maximum number of recurring job rules to return (default: 50)
     * @returns Promise resolving to a paginated list of recurring job rules
     */
    list(projectId: string, cursor?: string, limit?: number): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ListedRecurringRuleItem>>>>;
}
