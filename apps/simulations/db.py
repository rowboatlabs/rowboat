from pymongo import MongoClient
from bson import ObjectId
import os
from scenario_types import SimulationRun, Scenario, SimulationResult, SimulationAggregateResult

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/rowboat").strip()

SCENARIOS_COLLECTION_NAME = "scenarios"
API_KEYS_COLLECTION = "api_keys"
SIMULATIONS_COLLECTION_NAME = "simulation_runs"
SIMULATION_RESULT_COLLECTION_NAME = "simulation_result"
SIMULATION_AGGREGATE_RESULT_COLLECTION_NAME = "simulation_aggregate_result"

def get_db():
    client = MongoClient(MONGO_URI)
    return client.get_default_database()

def get_collection(collection_name: str):
    db = get_db()
    return db[collection_name]

def get_api_key(project_id: str):
    collection = get_collection(API_KEYS_COLLECTION)
    doc = collection.find_one({"projectId": project_id})
    if doc:
        return doc["key"]
    else:
        return None

def get_pending_simulation_run():
    collection = get_collection(SIMULATIONS_COLLECTION_NAME)
    doc = collection.find_one_and_update(
        {"status": "pending"},
        {"$set": {"status": "running"}},
        return_document=True
    )
    if doc:
        return SimulationRun(
            id=str(doc["_id"]),
            projectId=doc["projectId"],
            status="running",
            scenarioIds=doc["scenarioIds"],
            workflowId=doc["workflowId"],
            startedAt=doc["startedAt"],
            completedAt=doc.get("completedAt")
        )
    return None

def set_simulation_run_to_completed(simulation_run: SimulationRun):
    collection = get_collection(SIMULATIONS_COLLECTION_NAME)
    collection.update_one({"_id": ObjectId(simulation_run.id)}, {"$set": {"status": "completed"}})

def get_scenarios_for_run(simulation_run: SimulationRun):
    if simulation_run is None:
        return []
    collection = get_collection(SCENARIOS_COLLECTION_NAME)
    scenarios = []
    for doc in collection.find():
        if doc["_id"] in [ObjectId(sid) for sid in simulation_run.scenarioIds]:
            scenarios.append(Scenario(
                id=str(doc["_id"]),
                projectId=doc["projectId"],
                name=doc["name"],
                description=doc["description"],
                criteria=doc["criteria"],
                context=doc["context"],
                createdAt=doc["createdAt"],
                lastUpdatedAt=doc["lastUpdatedAt"]
            ))
    return scenarios

def write_simulation_result(result: SimulationResult):
    collection = get_collection(SIMULATION_RESULT_COLLECTION_NAME)
    collection.insert_one(result.model_dump())

def write_simulation_aggregate_result(result: SimulationAggregateResult):
    collection = get_collection(SIMULATION_AGGREGATE_RESULT_COLLECTION_NAME)
    collection.insert_one(result.model_dump())