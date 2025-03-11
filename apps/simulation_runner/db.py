from pymongo import MongoClient
from bson import ObjectId
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from scenario_types import (
    TestRun,
    TestScenario,
    TestSimulation,
    TestResult,
    AggregateResults
)

MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/rowboat").strip()

TEST_SCENARIOS_COLLECTION = "test_scenarios"
TEST_SIMULATIONS_COLLECTION = "test_simulations"
TEST_RUNS_COLLECTION = "test_runs"
TEST_RESULTS_COLLECTION = "test_results"
API_KEYS_COLLECTION = "api_keys"

def get_db():
    client = MongoClient(MONGO_URI)
    return client["rowboat"]

def get_collection(collection_name: str):
    db = get_db()
    return db[collection_name]

def get_api_key(project_id: str):
    """
    If you still use an API key pattern, adapt as needed.
    """
    collection = get_collection(API_KEYS_COLLECTION)
    doc = collection.find_one({"projectId": project_id})
    if doc:
        return doc["key"]
    else:
        return None

#
# TestRun helpers
#

def get_pending_run() -> Optional[TestRun]:
    """
    Finds a run with 'pending' status, marks it 'running', and returns it.
    """
    collection = get_collection(TEST_RUNS_COLLECTION)
    doc = collection.find_one_and_update(
        {"status": "pending"},
        {"$set": {"status": "running"}},
        return_document=True
    )
    if doc:
        return TestRun(
            id=str(doc["_id"]),
            projectId=doc["projectId"],
            name=doc["name"],
            simulationIds=doc["simulationIds"],
            workflowId=doc["workflowId"],
            status="running",
            startedAt=doc["startedAt"],
            completedAt=doc.get("completedAt"),
            aggregateResults=doc.get("aggregateResults"),
            lastHeartbeat=doc.get("lastHeartbeat")
        )
    return None

def set_run_to_completed(test_run: TestRun, aggregate: AggregateResults):
    """
    Marks a test run 'completed' and sets the aggregate results.
    """
    collection = get_collection(TEST_RUNS_COLLECTION)
    collection.update_one(
        {"_id": ObjectId(test_run.id)},
        {
            "$set": {
                "status": "completed",
                "aggregateResults": aggregate.model_dump(by_alias=True),
                "completedAt": datetime.now(timezone.utc)
            }
        }
    )

def update_run_heartbeat(run_id: str):
    """
    Updates the 'lastHeartbeat' timestamp for a TestRun.
    """
    collection = get_collection(TEST_RUNS_COLLECTION)
    collection.update_one(
        {"_id": ObjectId(run_id)},
        {"$set": {"lastHeartbeat": datetime.now(timezone.utc)}}
    )

def mark_stale_jobs_as_failed(threshold_minutes: int = 20) -> int:
    """
    Finds any run in 'running' status whose lastHeartbeat is older than
    `threshold_minutes`, and sets it to 'failed'. Returns the count.
    """
    collection = get_collection(TEST_RUNS_COLLECTION)
    stale_threshold = datetime.now(timezone.utc) - timedelta(minutes=threshold_minutes)
    result = collection.update_many(
        {
            "status": "running",
            "lastHeartbeat": {"$lt": stale_threshold}
        },
        {
            "$set": {"status": "failed"}
        }
    )
    return result.modified_count

#
# TestSimulation helpers
#

def get_simulations_for_run(test_run: TestRun) -> list[TestSimulation]:
    """
    Returns all simulations specified by a particular run.
    """
    if test_run is None:
        return []
    collection = get_collection(TEST_SIMULATIONS_COLLECTION)
    simulation_docs = collection.find({
        "_id": {"$in": [ObjectId(sim_id) for sim_id in test_run.simulationIds]}
    })

    simulations = []
    for doc in simulation_docs:
        simulations.append(
            TestSimulation(
                id=str(doc["_id"]),
                projectId=doc["projectId"],
                name=doc["name"],
                scenarioId=doc["scenarioId"],
                profileId=doc["profileId"],
                passCriteria=doc["passCriteria"],
                createdAt=doc["createdAt"],
                lastUpdatedAt=doc["lastUpdatedAt"]
            )
        )
    return simulations

def get_scenario_by_id(scenario_id: str) -> TestScenario:
    """
    Returns a TestScenario by its ID.
    """
    collection = get_collection(TEST_SCENARIOS_COLLECTION)
    doc = collection.find_one({"_id": ObjectId(scenario_id)})
    if doc:
        return TestScenario(
            id=str(doc["_id"]),
            projectId=doc["projectId"],
            name=doc["name"],
            description=doc["description"],
            createdAt=doc["createdAt"],
            lastUpdatedAt=doc["lastUpdatedAt"]
        )
    return None

#
# TestResult helpers
#

def write_test_result(result: TestResult):
    """
    Writes a test result into the `test_results` collection.
    """
    collection = get_collection(TEST_RESULTS_COLLECTION)
    collection.insert_one(result.model_dump())
