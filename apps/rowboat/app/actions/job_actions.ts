"use server";

import { container } from "@/di/container";
import { IListJobsController } from "@/src/interface-adapters/controllers/jobs/list-jobs.controller";
import { IFetchJobController } from "@/src/interface-adapters/controllers/jobs/fetch-job.controller";
import { authCheck } from "./auth_actions";

const listJobsController = container.resolve<IListJobsController>('listJobsController');
const fetchJobController = container.resolve<IFetchJobController>('fetchJobController');

export async function listJobs(request: {
    projectId: string,
    cursor?: string,
    limit?: number,
}) {
    const user = await authCheck();

    return await listJobsController.execute({
        caller: 'user',
        userId: user._id,
        projectId: request.projectId,
        cursor: request.cursor,
        limit: request.limit,
    });
}

export async function fetchJob(request: {
    jobId: string,
}) {
    const user = await authCheck();

    return await fetchJobController.execute({
        caller: 'user',
        userId: user._id,
        jobId: request.jobId,
    });
}