import { CreateRunData, Run, UpdateRunData } from "@/src/entities/models/run";
import { z } from "zod";

export interface IRunsRepository {
    // create a new run
    createRun(data: z.infer<typeof CreateRunData>): Promise<z.infer<typeof Run>>;

    // get a run by id
    getRun(id: string): Promise<z.infer<typeof Run> | null>;

    // save run data
    saveRun(id: string, data: z.infer<typeof UpdateRunData>): Promise<z.infer<typeof Run>>;

    // poll runs and acquire lock on a pending run
    pollRuns(workerId: string): Promise<z.infer<typeof Run> | null>;

    // acquire lock on a specific run
    lockRun(runId: string, workerId: string): Promise<z.infer<typeof Run> | null>;

    // release lock on run
    releaseRun(runId: string): Promise<boolean>;
}