from enum import Enum
from pydantic import BaseModel
from typing import List, Dict, Optional, Union, Callable
AgentFunction = Callable[[], Union[str, "Agent", dict]]

class Agent(BaseModel):
    name: str = "Agent"
    model: str = "gpt-4o"
    type: str = ""
    instructions: Union[str, Callable[[], str]] = "You are a helpful agent.",
    description: str = "This is a helpful agent."
    candidate_parent_functions: Dict[str, AgentFunction] = {}
    parent_function: AgentFunction = None
    child_functions: Dict[str, AgentFunction] = {}
    internal_tools: List[Dict] = []
    external_tools: List[Dict] = []
    tool_choice: str = None
    parallel_tool_calls: bool = True
    respond_to_user: bool = True
    history: List[Dict] = []
    children_names: List[str] = []
    children: Dict[str, "Agent"] = {}
    most_recent_parent: Optional["Agent"] = None
    parent: "Agent" = None


class AgentRole(Enum):
    ESCALATION = "escalation"
    POST_PROCESSING = "post_process"
    GUARDRAILS = "guardrails"

class ControlType(Enum):
    RETAIN = "retain"
    PARENT_AGENT = "relinquish_to_parent"
    START_AGENT = "relinquish_to_start"

class PromptType(Enum):
    STYLE = "style_prompt"

class ErrorType(Enum):
    FATAL = "fatal"
    ESCALATE = "escalate"

class ExecutionEngine(Enum):
    SWARM = "swarm"
    LANGGRAPH = "langgraph"

class Response(BaseModel):
    messages: List = []
    agent: Optional[Agent] = None
    context_variables: dict = {}
    error_msg: Optional[str] = ""
    tokens_used: dict = {}

class Result(BaseModel):
    """
    Encapsulates the possible return values for an agent function.

    Attributes:
        value (str): The result value as a string.
        agent (Agent): The agent instance, if applicable.
        context_variables (dict): A dictionary of context variables.
    """

    value: str = ""
    agent: Optional[Agent] = None
    context_variables: dict = {}