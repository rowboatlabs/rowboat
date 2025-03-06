from enum import Enum
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
    GREETING = "greeting"

class ErrorType(Enum):
    FATAL = "fatal"
    ESCALATE = "escalate"