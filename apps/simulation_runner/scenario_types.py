from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field

run_status = Literal["pending", "running", "completed", "cancelled", "failed"]

class Scenario(BaseModel):
    id: str
    projectId: str
    name: str = ""
    description: str = ""
    criteria: str = ""
    context: str = ""
    createdAt: datetime
    lastUpdatedAt: datetime

class SimulationRun(BaseModel):
    id: str
    projectId: str
    status: Literal["pending", "running", "completed", "cancelled", "failed"]
    scenarioIds: List[str]
    workflowId: str
    startedAt: datetime
    completedAt: Optional[datetime] = None
    aggregateResults: Optional[dict] = None


class SimulationResult(BaseModel):
    projectId: str
    runId: str
    scenarioId: str
    result: Literal["pass", "fail"]
    details: str

class SimulationAggregateResult(BaseModel):
    total: int
    pass_: int = Field(..., alias='pass')
    fail: int