import { Job } from "@/src/entities/models/job";
import { JobAcquisitionError } from "@/src/entities/errors/job-errors";
import { NotFoundError } from "@/src/entities/errors/common";
import { z } from "zod";

/**
 * Schema for creating a new job.
 * Defines the required fields when creating a job in the system.
 */
const createJobSchema = Job.pick({
    trigger: true,
    triggerData: true,
    projectId: true,
    input: true,
});

/**
 * Schema for updating an existing job.
 * Defines the fields that can be updated for a job.
 */
const updateJobSchema = Job.pick({
    status: true,
    output: true,
});

/**
 * Repository interface for managing jobs in the system.
 * 
 * This interface defines the contract for job management operations including
 * creation, polling, locking, updating, and releasing jobs. Jobs represent
 * asynchronous tasks that can be processed by workers.
 */
export interface IJobsRepository {
    /**
     * Creates a new job in the system.
     * 
     * @param data - The job data containing trigger information, project ID, and input
     * @returns Promise resolving to the created job with all fields populated
     */
    create(data: z.infer<typeof createJobSchema>): Promise<z.infer<typeof Job>>;

    /**
     * Polls for the next available job that can be processed by a worker.
     * 
     * This method should return the next job that is in "pending" status and
     * is not currently locked by another worker.
     * 
     * @param workerId - The unique identifier of the worker requesting a job
     * @returns Promise resolving to the next available job or null if no jobs are available
     */
    pollNextJob(workerId: string): Promise<z.infer<typeof Job> | null>;

    /**
     * Locks a specific job for processing by a worker.
     * 
     * This method should mark the job as "running" and associate it with the
     * specified worker ID to prevent other workers from processing it.
     * 
     * @param id - The unique identifier of the job to lock
     * @param workerId - The unique identifier of the worker locking the job
     * @returns Promise resolving to the locked job
     * @throws {JobAcquisitionError} if the job is already locked or doesn't exist
     */
    lockJob(id: string, workerId: string): Promise<z.infer<typeof Job>>;

    /**
     * Updates an existing job with new status and/or output data.
     * 
     * @param id - The unique identifier of the job to update
     * @param data - The data to update (status and/or output)
     * @returns Promise resolving to the updated job
     * @throws {NotFoundError} if the job doesn't exist
     */
    update(id: string, data: z.infer<typeof updateJobSchema>): Promise<z.infer<typeof Job>>;

    /**
     * Releases a job lock, making it available for other workers.
     * 
     * This method should clear the workerId association and potentially
     * reset the status back to "pending" if the job was not completed.
     * 
     * @param id - The unique identifier of the job to release
     * @returns Promise that resolves when the job has been released
     */
    release(id: string): Promise<void>;
}