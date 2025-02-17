import asyncio
import logging
from typing import List
from db import get_pending_simulation_run, get_scenarios_for_run, set_simulation_run_to_completed, get_api_key
from scenario_types import SimulationRun, Scenario
from simulation import simulate_scenarios
logging.basicConfig(level=logging.INFO)

class JobService:
    def __init__(self):
        self.poll_interval = 5  # seconds
        self.semaphore = asyncio.Semaphore(5)

    async def poll_and_process_jobs(self, max_iterations: int = None):
        """
        Periodically checks for new jobs in MongoDB and processes them.
        """
        iterations = 0
        while True:
            job = get_pending_simulation_run()
            if job:
                logging.info(f"Found new job: {job}. Processing...")
                asyncio.create_task(self.process_job(job))
            else:
                logging.info("No new jobs found. Checking again in 5 seconds...")

            iterations += 1
            if max_iterations is not None and iterations >= max_iterations:
                break
            # Sleep for the polling interval
            await asyncio.sleep(self.poll_interval)

    async def process_job(self, job: SimulationRun):
        """
        Calls the simulation function and updates job status upon completion.
        """
        async with self.semaphore:
            scenarios = get_scenarios_for_run(job)
            if not scenarios or len(scenarios) == 0:
                logging.info(f"No scenarios found for job {job.id}")
                return

            api_key = get_api_key(job.projectId)
            result = await simulate_scenarios(scenarios, job.id, job.workflowId, api_key)

            if result:
                set_simulation_run_to_completed(job)
                logging.info(f"Job {job.id} completed.")

    def start(self):
        """
        Entry point to start the service event loop.
        """
        loop = asyncio.get_event_loop()
        try:
            loop.run_until_complete(self.poll_and_process_jobs())
        except KeyboardInterrupt:
            logging.info("Service stopped by user.")
        finally:
            loop.close()

if __name__ == "__main__":
    # Example usage:
    # Replace these with your actual URI, database, and collection.
    service = JobService()
    asyncio.run(service.poll_and_process_jobs(max_iterations=2))
    #asyncio.run(service.poll_and_process_jobs(max_iterations=2))
    #service.start()
