import asyncio
import logging
from typing import List
from db import get_pending_simulation_run, get_scenarios_for_run, set_simulation_run_to_completed, get_api_key, mark_stale_jobs_as_failed, update_simulation_run_heartbeat
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

        # Start the stale-job check in the background
        asyncio.create_task(self.fail_stale_jobs_loop())

        iterations = 0
        while True:
            job = get_pending_simulation_run()
            if job:
                logging.info(f"Found new job: {job}. Processing...")
                asyncio.create_task(self.process_job(job))

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
            # Start heartbeat in background
            stop_heartbeat_event = asyncio.Event()
            heartbeat_task = asyncio.create_task(self.heartbeat_loop(job.id, stop_heartbeat_event))

            try:
                scenarios = get_scenarios_for_run(job)
                if not scenarios or len(scenarios) == 0:
                    logging.info(f"No scenarios found for job {job.id}")
                    return

                api_key = get_api_key(job.projectId)
                result = await simulate_scenarios(scenarios, job.id, job.workflowId, api_key)


                set_simulation_run_to_completed(job, result)
                logging.info(f"Job {job.id} completed.")
            except Exception as exc:
                logging.error(f"Job {job.id} failed: {exc}")
            finally:
                stop_heartbeat_event.set()
                await heartbeat_task

    async def fail_stale_jobs_loop(self):
        """
        Periodically checks for stale jobs that haven't received a heartbeat in over 5 minutes,
        and marks them as 'failed'.
        """
        while True:
            count = mark_stale_jobs_as_failed()
            if count > 0:
                logging.warning(f"Marked {count} stale jobs as failed.")
            await asyncio.sleep(60)  # Check every 60 seconds

    async def heartbeat_loop(self, job_id: str, stop_event: asyncio.Event):
        """
        Periodically updates 'last_heartbeat' for the given job until 'stop_event' is set.
        """

        try:
            while not stop_event.is_set():
                update_simulation_run_heartbeat(job_id)
                await asyncio.sleep(10)  # Heartbeat interval in seconds
        except asyncio.CancelledError:
            pass

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
    service = JobService()
    service.start()
