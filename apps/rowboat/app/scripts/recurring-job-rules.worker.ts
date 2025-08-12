import { container } from "@/di/container";
import { IRecurringJobRulesWorker } from "@/src/application/workers/recurring-job-rules.worker";

async function main() {
    const worker = container.resolve<IRecurringJobRulesWorker>('recurringJobRulesWorker');
    
    console.log('Starting recurring job rules worker...');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('Received SIGINT, shutting down gracefully...');
        await worker.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('Received SIGTERM, shutting down gracefully...');
        await worker.stop();
        process.exit(0);
    });
    
    try {
        await worker.run();
        console.log('Recurring job rules worker started successfully');
        
        // Keep the process alive
        await new Promise(() => {});
    } catch (error) {
        console.error('Failed to start recurring job rules worker:', error);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Unhandled error in recurring job rules worker:', error);
    process.exit(1);
});
