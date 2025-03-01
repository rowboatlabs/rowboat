from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field

# Define run statuses to include the new "error" status
RunStatus = Literal["pending", "running", "completed", "cancelled", "failed", "error"]

class TestScenario(BaseModel):
    # `_id` in Mongo will be stored as ObjectId; we return it as a string
    id: str
    projectId: str
    name: str
    description: str
    createdAt: datetime
    lastUpdatedAt: datetime

class TestProfile(BaseModel):
    id: str
    projectId: str
    name: str
    context: str
    createdAt: datetime
    lastUpdatedAt: datetime
    mockTools: bool
    mockPrompt: Optional[str] = None

class TestSimulation(BaseModel):
    id: str
    projectId: str
    name: str
    scenarioId: str
    profileId: str
    passCriteria: str
    createdAt: datetime
    lastUpdatedAt: datetime

class AggregateResults(BaseModel):
    total: int
    passCount: int
    failCount: int

class TestRun(BaseModel):
    id: str
    projectId: str
    name: str
    simulationIds: List[str]
    workflowId: str
    status: RunStatus
    startedAt: datetime
    completedAt: Optional[datetime] = None
    # By default, store aggregate results as a dict or the typed AggregateResults
    aggregateResults: Optional[AggregateResults] = None

    # The new schema does not mention lastHeartbeat, 
    # but you can keep it if you still want to track stale runs
    lastHeartbeat: Optional[datetime] = None

class TestResult(BaseModel):
    projectId: str
    runId: str
    simulationId: str
    result: Literal["pass", "fail"]
    details: str
