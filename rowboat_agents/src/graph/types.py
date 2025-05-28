from enum import Enum
class AgentRole(Enum):
    ESCALATION = "escalation"
    POST_PROCESSING = "post_process"
    GUARDRAILS = "guardrails"

class outputVisibility(Enum):
    EXTERNAL = "user_facing"
    INTERNAL = "internal"

class ResponseType(Enum):
    INTERNAL = "internal"
    EXTERNAL = "external"

class ControlType(Enum):
    RETAIN = "retain"
    PARENT_AGENT = "relinquish_to_parent"
    START_AGENT = "start_agent"

class PromptType(Enum):
    STYLE = "style_prompt"
    GREETING = "greeting"

class ErrorType(Enum):
    FATAL = "fatal"
    ESCALATE = "escalate"