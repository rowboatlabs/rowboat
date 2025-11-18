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

export const UpdateJobSchema = ScheduledJobRule.pick({
    status: true,
    output: true,
});

/**
 * Schema for updating a scheduled job rule's next run configuration.
 */
export const UpdateScheduledRuleSchema = ScheduledJobRule
    .pick({
        input: true,
    })
    .extend({
        scheduledTime: z.string().datetime(),
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
     * Updates a scheduled job rule with new status and output data.
     * 
     * @param id - The unique identifier of the scheduled job rule to update
     * @param data - The update data containing status and output fields
     * @returns Promise resolving to the updated scheduled job rule
     * @throws {NotFoundError} if the scheduled job rule doesn't exist
     */
    update(id: string, data: z.infer<typeof UpdateJobSchema>): Promise<z.infer<typeof ScheduledJobRule>>;

    /**
     * Updates a scheduled job rule with new input and scheduled time.
     * 
     * @param id - The unique identifier of the scheduled job rule to update
     * @param data - The update data containing input messages and scheduled time
     * @returns Promise resolving to the updated scheduled job rule
     * @throws {NotFoundError} if the scheduled job rule doesn't exist
     */
    updateRule(id: string, data: z.infer<typeof UpdateScheduledRuleSchema>): Promise<z.infer<typeof ScheduledJobRule>>;

    /**
     * Releases a scheduled job rule after it has been executed.
     * 
     * @param id - The unique identifier of the scheduled job rule to release
     * @returns Promise resolving to the updated scheduled job rule
     * @throws {NotFoundError} if the scheduled job rule doesn't exist
     */
    release(id: string): Promise<z.infer<typeof ScheduledJobRule>>;

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
     * Deletes a scheduled job rule by its unique identifier.
     * 
     * @param id - The unique identifier of the scheduled job rule to delete
     * @returns Promise resolving to true if the rule was deleted, false if not found
     */
    delete(id: string): Promise<boolean>;

    /**
     * Deletes all scheduled job rules associated with a specific project.
     * 
     * @param projectId - The unique identifier of the project
     * @returns Promise resolving to void
     */
    deleteByProjectId(projectId: string): Promise<void>;
}
