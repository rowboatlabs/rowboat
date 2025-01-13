import json
import random

from src.utils.common import common_logger
logger = common_logger

RAG_TOOL = {
    "name": "getArticleInfo",
    "type": "rag",
    "description": "Fetch articles with knowledge relevant to the query",
    "parameters": {
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "The query to retrieve articles for"
            }
        },
        "required": [
            "query"
        ]
    }
}

CLOSE_CHAT_TOOL = {
    "name": "close_chat",
    "type": "close_chat",
    "description": "Close the chat",
    "parameters": {
        "type": "object",
        "properties": {
            "error_message": {
                "type": "string", "description": "The error message to close the chat with"
            }
        }
    }
}

def tool_raise_error(error_message):
    logger.error(f"Raising error: {error_message}")
    raise ValueError(f"Raising error: {error_message}")

def respond_to_tool_raise_error(tool_calls, mock=False):
    error_message = json.loads(tool_calls[0]["function"]["arguments"]).get("error_message", "")
    return _create_tool_response(tool_calls, tool_raise_error(error_message))

def tool_close_chat(error_message):
    logger.error(f"Closing chat: {error_message}")
    raise ValueError(f"Closing chat: {error_message}")

def respond_to_tool_close_chat(tool_calls, mock=False):
    error_message = json.loads(tool_calls[0]["function"]["arguments"]).get("error_message", "")
    return _create_tool_response(tool_calls, tool_close_chat(error_message))

def _create_tool_response(tool_calls, content, mock=False):
    """
    Creates a standardized tool response format.
    """
    return {
        "role": "tool",
        "content": content,
        "tool_call_id": tool_calls[0]["id"],
        "name": tool_calls[0]["function"]["name"]
    }

def create_error_tool_call(error_message):
    error_message_tool_call = {
        "role": "assistant",
        "sender": "system",
        "tool_calls": [
            {
                "function": {
                    "name": "raise_error",
                    "arguments": "{\"error_message\":\"" + error_message + "\"}"
                },
                "id": "call_" + ''.join(random.choices('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', k=24)),
                "type": "function"
            }
        ]
    }
    return error_message_tool_call