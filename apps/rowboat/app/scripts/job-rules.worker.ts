import '../lib/loadenv';
import { container } from "@/di/container";
import { IJobRulesWorker } from "@/src/application/workers/job-rules.worker";

(async () => {
    try {
        const worker = container.resolve<IJobRulesWorker>('jobRulesWorker');
        await worker.run();
    } catch (error) {
        console.error(`Unable to run scheduled job rules worker: ${error}`);
    }
})();