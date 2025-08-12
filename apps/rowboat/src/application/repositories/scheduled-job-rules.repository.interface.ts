import { NotFoundError } from "@/src/entities/errors/common";
import { z } from "zod";
import { PaginatedList } from "@/src/entities/common/paginated-list";
import { ScheduledJobRule } from "@/src/entities/models/scheduled-job-rule";

/**
 * Schema for creating a new scheduled job rule.
 */
export const CreateRuleSchema = ScheduledJobRule
    .pick({
        projectId: true,
        input: true,
    })
    .extend({
        scheduledTime: z.string().datetime(),
    });

export const ListedRuleItem = ScheduledJobRule.omit({
    input: true,
});

/**
 * Repository interface for managing scheduled job rules in the system.
 * 
 * This interface defines the contract for scheduled job rule management operations including
 * creation, fetching, polling, processing, and listing rules. Scheduled job rules represent
 * recurring or scheduled tasks that can be processed by workers at specified times.
 */
export interface IScheduledJobRulesRepository {
    /**
     * Creates a new scheduled job rule in the system.
     * 
     * @param data - The rule data containing project ID, input messages, and scheduled run time
     * @returns Promise resolving to the created scheduled job rule with all fields populated
     */
    create(data: z.infer<typeof CreateRuleSchema>): Promise<z.infer<typeof ScheduledJobRule>>;

    /**
     * Fetches a scheduled job rule by its unique identifier.
     * 
     * @param id - The unique identifier of the scheduled job rule to fetch
     * @returns Promise resolving to the scheduled job rule or null if not found
     */
    fetch(id: string): Promise<z.infer<typeof ScheduledJobRule> | null>;

    /**
     * Polls for the next available scheduled job rule that can be processed by a worker.
     * 
     * This method should return the next rule that is ready to be processed (not yet processed)
     * and is not currently locked by another worker. The rules should be ordered by their scheduled
     * run time (nextRunAt) in ascending order.
     * 
     * @param workerId - The unique identifier of the worker requesting a scheduled job rule
     * @returns Promise resolving to the next available scheduled job rule or null if no rules are available
     */
    poll(workerId: string): Promise<z.infer<typeof ScheduledJobRule> | null>;

    /**
     * Processes and releases a scheduled job rule after it has been executed.
     * 
     * @param id - The unique identifier of the scheduled job rule to process
     * @param jobId - The unique identifier of the job that was created from this rule
     * @returns Promise resolving to the updated scheduled job rule
     * @throws {NotFoundError} if the scheduled job rule doesn't exist
     */
    processAndRelease(id: string, jobId: string): Promise<z.infer<typeof ScheduledJobRule>>;

    /**
     * Lists scheduled job rules for a specific project with pagination.
     * 
     * @param projectId - The unique identifier of the project
     * @param cursor - Optional cursor for pagination
     * @param limit - Maximum number of scheduled job rules to return (default: 50)
     * @returns Promise resolving to a paginated list of scheduled job rules
     */
    list(projectId: string, cursor?: string, limit?: number): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ListedRuleItem>>>>;

    /**
     * Disables a scheduled job rule by its unique identifier.
     * 
     * @param id - The unique identifier of the scheduled job rule to disable
     * @returns Promise resolving to the updated scheduled job rule
     */
    disable(id: string): Promise<z.infer<typeof ScheduledJobRule>>;

    /**
     * Enables a scheduled job rule by its unique identifier.
     * 
     * @param id - The unique identifier of the scheduled job rule to enable
     * @returns Promise resolving to the updated scheduled job rule
     */
    enable(id: string): Promise<z.infer<typeof ScheduledJobRule>>;
}