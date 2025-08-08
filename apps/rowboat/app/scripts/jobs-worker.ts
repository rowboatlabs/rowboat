import '../lib/loadenv';
import { container } from "@/di/container";
import { IJobsWorker } from "@/src/application/workers/jobs.worker";

(async () => {
    try {
        const jobsWorker = container.resolve<IJobsWorker>('jobsWorker');
        await jobsWorker.run();
    } catch (error) {
        console.error(`Unable to run jobs worker: ${error}`);
    }
})();