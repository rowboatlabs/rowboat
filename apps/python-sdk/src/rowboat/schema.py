from typing import List, Optional, Union, Literal, Dict
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
    agenticName: Optional[str] = None
    responseType: Literal['internal', 'external']

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
    toolCalls: List[ToolCall]
    agenticName: Optional[str] = None

class ToolMessage(BaseModel):
    role: Literal['tool']
    content: str
    toolCallId: str
    toolName: str

ApiMessage = Union[
    SystemMessage,
    UserMessage,
    AssistantMessage,
    AssistantMessageWithToolCalls,
    ToolMessage
]

class Turn(BaseModel):
    id: str
    output: List[ApiMessage]

class ApiRequest(BaseModel):
    conversationId: Optional[str] = None
    messages: List[ApiMessage]
    mockTools: Optional[Dict[str, str]] = None

class ApiResponse(BaseModel):
    conversationId: str
    turn: Turn