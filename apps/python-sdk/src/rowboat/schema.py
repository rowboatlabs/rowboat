from typing import List, Optional, Union, Any, Literal
from pydantic import BaseModel

class SystemMessage(BaseModel):
    role: Literal['system']
    content: str

class UserMessage(BaseModel):
    role: Literal['user']
    content: str

class AssistantMessage(BaseModel):
    role: Literal['assistant']
    content: str
    agenticSender: Optional[str] = None
    agenticResponseType: Literal['internal', 'external']

class FunctionCall(BaseModel):
    name: str
    arguments: str

class ToolCall(BaseModel):
    id: str
    type: Literal['function']
    function: FunctionCall

class AssistantMessageWithToolCalls(BaseModel):
    role: Literal['assistant']
    content: Optional[str] = None
    tool_calls: List[ToolCall]
    agenticSender: Optional[str] = None
    agenticResponseType: Literal['internal', 'external']

class ToolMessage(BaseModel):
    role: Literal['tool']
    content: str
    tool_call_id: str
    tool_name: str

ApiMessage = Union[
    SystemMessage,
    UserMessage,
    AssistantMessage,
    AssistantMessageWithToolCalls,
    ToolMessage
]

class ApiRequest(BaseModel):
    messages: List[ApiMessage]
    state: Any
    skipToolCalls: Optional[bool] = None
    maxTurns: Optional[int] = None
    workflowId: Optional[str] = None
    testProfileId: Optional[str] = None

class ApiResponse(BaseModel):
    messages: List[ApiMessage]
    state: Any 