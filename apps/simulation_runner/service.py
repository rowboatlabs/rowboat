import asyncio
import logging
from typing import List, Optional

# Updated imports from your new db module and scenario_types
from db import (
    get_pending_run,
    get_simulations_for_run,
    set_run_to_completed,
    get_api_key,
    mark_stale_jobs_as_failed,
    update_run_heartbeat
)
from scenario_types import TestRun, TestSimulation
# If you have a new simulation function, import it here.
# Otherwise, adapt the name as needed:
from simulation import simulate_simulations  # or simulate_scenarios, if unchanged

logging.basicConfig(level=logging.INFO)

class JobService:
    def __init__(self):
        self.poll_interval = 5  # seconds
        # Control concurrency of run processing
        self.semaphore = asyncio.Semaphore(5)

    async def poll_and_process_jobs(self, max_iterations: Optional[int] = None):
        """
        Periodically checks for new runs in MongoDB and processes them.
        """
        # Start the stale-run check in the background
        asyncio.create_task(self.fail_stale_runs_loop())

        iterations = 0
        while True:
            run = get_pending_run()  # <--- changed to match new DB function
            if run:
                logging.info(f"Found new run: {run}. Processing...")
                asyncio.create_task(self.process_run(run))

            iterations += 1
            if max_iterations is not None and iterations >= max_iterations:
                break

            # Sleep for the polling interval
            await asyncio.sleep(self.poll_interval)

    async def process_run(self, run: TestRun):
        """
        Calls the simulation function and updates run status upon completion.
        """
        async with self.semaphore:
            # Start heartbeat in background
            stop_heartbeat_event = asyncio.Event()
            heartbeat_task = asyncio.create_task(self.heartbeat_loop(run.id, stop_heartbeat_event))

            try:
                # Fetch the simulations associated with this run
                simulations = get_simulations_for_run(run)
                if not simulations:
                    logging.info(f"No simulations found for run {run.id}")
                    return

                # Fetch API key if needed
                api_key = get_api_key(run.projectId)

                # Perform your simulation logic
                # adapt this call to your actual simulation function’s signature
                aggregate_result = await simulate_simulations(
                    simulations=simulations,
                    run_id=run.id,
                    workflow_id=run.workflowId,
                    api_key=api_key
                )

                # Mark run as completed with the aggregated result
                set_run_to_completed(run, aggregate_result)
                logging.info(f"Run {run.id} completed.")
            except Exception as exc:
                logging.error(f"Run {run.id} failed: {exc}")
            finally:
                stop_heartbeat_event.set()
                await heartbeat_task

    async def fail_stale_runs_loop(self):
        """
        Periodically checks for stale runs (no heartbeat) and marks them as 'failed'.
        """
        while True:
            count = mark_stale_jobs_as_failed()
            if count > 0:
                logging.warning(f"Marked {count} stale runs as failed.")
            await asyncio.sleep(60)  # Check every 60 seconds

    async def heartbeat_loop(self, run_id: str, stop_event: asyncio.Event):
        """
        Periodically updates 'lastHeartbeat' for the given run until 'stop_event' is set.
        """
        try:
            while not stop_event.is_set():
                update_run_heartbeat(run_id)
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
