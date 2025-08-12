import '../lib/loadenv';
import { container } from "@/di/container";
import { IScheduledJobRulesWorker } from "@/src/application/workers/scheduled-job-rules.worker";

(async () => {
    try {
        const worker = container.resolve<IScheduledJobRulesWorker>('scheduledJobRulesWorker');
        await worker.run();
    } catch (error) {
        console.error(`Unable to run scheduled job rules worker: ${error}`);
    }
})();


