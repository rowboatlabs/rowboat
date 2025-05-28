import litellm
import requests
import os
from typing import Optional, Union, Dict, Any, AsyncGenerator
import logging
import sys
import json
import asyncio
import aiohttp
import uuid
import re

# Set up logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

logger.debug("Loading custom_handler.py")
logger.debug(f"Python path: {sys.path}")

class ModalLLM:
    def __init__(self, api_base: Optional[str] = None):
        logger.debug("Initializing ModalLLM")
        self.api_base = api_base or "https://stevef1uk--ollama-api-api.modal.run"
        logger.debug(f"Using API base: {self.api_base}")
        # Log environment variables at initialization
        logger.debug(f"Environment variables at init - TOKEN_ID: {os.getenv('TOKEN_ID')}, TOKEN_SECRET: {os.getenv('TOKEN_SECRET')}")

    def completion(
        self,
        model: str,
        messages: list,
        model_response: Optional[Dict] = None,
        optional_params: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> Dict:
        logger.debug("Starting completion request")
        logger.debug(f"Model: {model}")
        logger.debug(f"Messages: {messages}")
        logger.debug(f"kwargs: {kwargs}")
        logger.debug(f"optional_params: {optional_params}")
        
        # Get credentials from kwargs or environment variables
        token = kwargs.get("api_key") or os.getenv("TOKEN_ID")
        secret = kwargs.get("token_secret") or os.getenv("TOKEN_SECRET")
        
        logger.debug(f"Using token: {token[:8]}..." if token else "No token found")
        logger.debug(f"Using secret: {secret[:8]}..." if secret else "No secret found")
        
        # Check if this is a proxy request
        if "authorization" in kwargs:
            logger.debug("Detected proxy request")
            logger.debug(f"Authorization header: {kwargs['authorization']}")
            # Extract credentials from proxy authorization
            auth_header = kwargs["authorization"]
            if auth_header.startswith("Bearer "):
                auth_token = auth_header[7:]  # Remove "Bearer " prefix
                logger.debug(f"Auth token after removing Bearer: {auth_token}")
                # If this is a LiteLLM virtual key, use environment variables
                if auth_token.startswith("sk-"):
                    logger.debug("Detected LiteLLM virtual key")
                    # For proxy requests with virtual keys, use environment variables
                    token = os.getenv("TOKEN_ID")
                    secret = os.getenv("TOKEN_SECRET")
                    if not token or not secret:
                        error_msg = "Modal credentials not found in environment variables"
                        logger.error(error_msg)
                        raise ValueError(error_msg)
                    logger.debug(f"Using Modal credentials from environment - Token: {token[:8]}..., Secret: {secret[:8]}...")
                else:
                    # Try to split the token into key and secret
                    if ":" in auth_token:
                        token, secret = auth_token.split(":", 1)
                        logger.debug("Extracted credentials from proxy authorization with key:secret format")
                        logger.debug(f"Token: {token[:8]}..., Secret: {secret[:8]}...")
                    else:
                        # If no colon, use the token as is
                        token = auth_token
                        logger.debug("Using token directly from proxy authorization")
                        logger.debug(f"Token: {token[:8]}...")
            else:
                logger.error("Invalid proxy authorization format")
                raise ValueError("Invalid proxy authorization format")
        else:
            logger.debug("No authorization header found in kwargs")
            logger.debug("Available kwargs keys: " + str(list(kwargs.keys())))

        if not token:
            error_msg = "Missing token. Please provide a valid token."
            logger.error(error_msg)
            raise ValueError(error_msg)

        headers = {
            "Content-Type": "application/json",
            "Modal-Key": token
        }
        
        # Only add Modal-Secret if we have it
        if secret:
            headers["Modal-Secret"] = secret
        
        logger.debug(f"Final headers: {headers}")

        # Extract model name from the input model string
        # Handle format like "modal/mistral:latest" -> "mistral:latest"
        if "/" in model:
            model_name = model.split("/", 1)[1]  # Get everything after the first /
        else:
            model_name = model
        logger.debug(f"Extracted model name: {model_name}")

        # Combine all messages into a single prompt
        prompt = ""
        for msg in messages:
            if msg["role"] == "system":
                prompt += msg["content"] + "\n\n"
            elif msg["role"] == "user":
                prompt += "User: " + msg["content"] + "\n"
            elif msg["role"] == "assistant":
                prompt += "Assistant: " + msg["content"] + "\n"
        prompt = prompt.strip()
        logger.debug(f"Combined prompt: {prompt}")

        # Prepare the payload
        payload = {
            "prompt": prompt,
            "temperature": 0.7,
            "model": model_name
        }

        # Add tools if provided
        if "tools" in kwargs:
            tools = kwargs["tools"]
            logger.debug(f"Tools provided: {tools}")
            # Include tools in the prompt instead of as a separate parameter
            tool_descriptions = []
            for tool in tools:
                if "function" in tool:
                    tool_desc = f"- {tool['function']['name']}: {tool['function']['description']}"
                    if "parameters" in tool["function"]:
                        params = tool["function"]["parameters"]
                        if "properties" in params:
                            param_desc = []
                            for param_name, param_info in params["properties"].items():
                                param_desc.append(f"{param_name} ({param_info.get('type', 'any')})")
                            tool_desc += f" Parameters: {', '.join(param_desc)}"
                    tool_descriptions.append(tool_desc)
            
            if tool_descriptions:
                prompt += "\n\nAvailable tools:\n" + "\n".join(tool_descriptions)
                prompt += "\n\nYou are a helpful assistant that can use tools. When you need to use a tool, you must respond with a JSON object in this exact format:\n"
                prompt += """{
  "role": "assistant",
  "content": null,
  "tool_calls": [{
    "function": {
      "name": "TOOL_NAME",
      "arguments": "{\\"param1\\": value1}"
    },
    "id": "call_123",
    "type": "function"
  }],
  "tool_call_id": null,
  "tool_name": null,
  "response_type": "internal"
}"""

                # Add the user's query
                for msg in messages:
                    if msg["role"] == "user":
                        prompt += f"\n\nUser: {msg['content']}"
                        break

                # Add explicit instruction to use tools
                prompt += "\n\nIMPORTANT: You must use the available tools to help the user. Do not respond with regular text unless you have used all relevant tools first. When using a tool, make sure to use the exact format shown above."
                payload["prompt"] = prompt
                logger.debug(f"Updated prompt with tools: {prompt}")

        logger.debug(f"Final payload with model: {payload}")

        try:
            logger.debug(f"Making request to {self.api_base}")
            logger.debug(f"Headers: {headers}")
            logger.debug(f"Payload: {payload}")
            
            # Log the exact curl command that would be used
            curl_command = f"""curl -X POST "{self.api_base}" \\
  -H "Content-Type: application/json" \\
  -H "Modal-Key: {token}" \\
  -H "Modal-Secret: {secret}" \\
  -d '{json.dumps(payload)}'"""
            logger.debug(f"Equivalent curl command:\n{curl_command}")
            
            # Use requests.Session for better connection handling
            with requests.Session() as session:
                try:
                    logger.debug("Creating session and preparing request")
                    response = session.post(
                        self.api_base,
                        json=payload,
                        headers=headers,
                        verify=True,
                        timeout=60,  # Increased timeout
                        stream=True  # Enable streaming
                    )
                    logger.debug("Request completed")
                except requests.exceptions.SSLError as e:
                    logger.error(f"SSL Error: {str(e)}")
                    raise
                except requests.exceptions.ConnectionError as e:
                    logger.error(f"Connection Error: {str(e)}")
                    raise
                except requests.exceptions.Timeout as e:
                    logger.error(f"Timeout Error: {str(e)}")
                    raise
                except requests.exceptions.RequestException as e:
                    logger.error(f"Request Exception: {str(e)}")
                    raise
                
                logger.debug(f"Response status: {response.status_code}")
                logger.debug(f"Response headers: {dict(response.headers)}")
                
                if response.status_code == 401:
                    logger.error("Authentication failed. Please check your Modal credentials")
                    raise Exception("Authentication failed. Please check your Modal credentials")
                
                response.raise_for_status()
                
                # Handle streaming response
                full_response = ""
                for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
                    if chunk:
                        logger.debug(f"Received chunk: {chunk}")
                        full_response += chunk
                
                logger.debug(f"Full response: {full_response}")
                
                try:
                    # Try to parse the response as JSON
                    response_data = json.loads(full_response)
                    logger.debug(f"Parsed JSON response: {response_data}")
                    
                    # Transform the response to the correct format
                    transformed_data = transform_to_correct_format(full_response)
                    if transformed_data:
                        response_data = transformed_data
                    
                    # Extract the response text
                    if isinstance(response_data, dict):
                        response_text = response_data.get("response", "")
                        # Check for tool calls in the response
                        if "tool_calls" in response_data:
                            return {
                                "id": "modal-response",
                                "choices": [{
                                    "message": {
                                        "role": "assistant",
                                        "content": response_text,
                                        "tool_calls": response_data["tool_calls"]
                                    },
                                    "finish_reason": "tool_calls"
                                }],
                                "created": 0,
                                "model": model,
                                "usage": {}
                            }
                    else:
                        response_text = str(response_data)
                except json.JSONDecodeError:
                    # If not JSON, treat as raw text
                    logger.debug("Response is not JSON, treating as raw text")
                    if "assistant" in full_response.lower():
                        response_text = full_response.split("assistant", 1)[1].strip()
                    else:
                        response_text = full_response.strip()
                    
                    # Remove any remaining user prompt
                    if "user" in response_text.lower():
                        response_text = response_text.split("user", 1)[0].strip()
                    
                    # Try to transform text response into tool call
                    transformed_data = transform_to_correct_format(response_text)
                    if transformed_data and "tool_calls" in transformed_data:
                        return {
                            "id": "modal-response",
                            "choices": [{
                                "message": {
                                    "role": "assistant",
                                    "content": "",
                                    "tool_calls": transformed_data["tool_calls"]
                                },
                                "finish_reason": "tool_calls"
                            }],
                            "created": 0,
                            "model": model,
                            "usage": {}
                        }
                
                if not response_text:
                    logger.error(f"Unexpected response format: {full_response}")
                    raise Exception("Unexpected response format from Modal API")
                
                return {
                    "id": "modal-response",
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": response_text
                        },
                        "finish_reason": "stop"
                    }],
                    "created": 0,
                    "model": model,
                    "usage": {}
                }
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Request failed: {str(e)}")
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"Response text: {e.response.text}")
            raise Exception(f"Error connecting to Modal API: {str(e)}")

    async def acompletion(
        self,
        model: str,
        messages: list,
        model_response: Optional[Dict] = None,
        optional_params: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> Dict:
        logger.debug("Starting async completion request")
        logger.debug(f"Model: {model}")
        logger.debug(f"Messages: {messages}")
        logger.debug(f"kwargs: {kwargs}")
        logger.debug(f"optional_params: {optional_params}")
        
        # Get credentials from kwargs or environment variables
        token = kwargs.get("api_key") or os.getenv("TOKEN_ID")
        secret = kwargs.get("token_secret") or os.getenv("TOKEN_SECRET")
        
        logger.debug(f"Using token: {token[:8]}..." if token else "No token found")
        logger.debug(f"Using secret: {secret[:8]}..." if secret else "No secret found")
        
        # Check if this is a proxy request
        if "authorization" in kwargs:
            logger.debug("Detected proxy request")
            logger.debug(f"Authorization header: {kwargs['authorization']}")
            # Extract credentials from proxy authorization
            auth_header = kwargs["authorization"]
            if auth_header.startswith("Bearer "):
                auth_token = auth_header[7:]  # Remove "Bearer " prefix
                logger.debug(f"Auth token after removing Bearer: {auth_token}")
                # If this is a LiteLLM virtual key, use environment variables
                if auth_token.startswith("sk-"):
                    logger.debug("Detected LiteLLM virtual key")
                    # For proxy requests with virtual keys, use environment variables
                    token = os.getenv("TOKEN_ID")
                    secret = os.getenv("TOKEN_SECRET")
                    if not token or not secret:
                        error_msg = "Modal credentials not found in environment variables"
                        logger.error(error_msg)
                        raise ValueError(error_msg)
                    logger.debug(f"Using Modal credentials from environment - Token: {token[:8]}..., Secret: {secret[:8]}...")
                else:
                    # Try to split the token into key and secret
                    if ":" in auth_token:
                        token, secret = auth_token.split(":", 1)
                        logger.debug("Extracted credentials from proxy authorization with key:secret format")
                        logger.debug(f"Token: {token[:8]}..., Secret: {secret[:8]}...")
                    else:
                        # If no colon, use the token as is
                        token = auth_token
                        logger.debug("Using token directly from proxy authorization")
                        logger.debug(f"Token: {token[:8]}...")
            else:
                logger.error("Invalid proxy authorization format")
                raise ValueError("Invalid proxy authorization format")
        else:
            logger.debug("No authorization header found in kwargs")
            logger.debug("Available kwargs keys: " + str(list(kwargs.keys())))

        if not token:
            error_msg = "Missing token. Please provide a valid token."
            logger.error(error_msg)
            raise ValueError(error_msg)

        headers = {
            "Content-Type": "application/json",
            "Modal-Key": token
        }
        
        # Only add Modal-Secret if we have it
        if secret:
            headers["Modal-Secret"] = secret
        
        logger.debug(f"Final headers: {headers}")

        # Extract model name from the input model string
        # Handle format like "modal/mistral:latest" -> "mistral:latest"
        if "/" in model:
            model_name = model.split("/", 1)[1]  # Get everything after the first /
        else:
            model_name = model
        logger.debug(f"Extracted model name: {model_name}")

        # Combine all messages into a single prompt
        prompt = ""
        for msg in messages:
            if msg["role"] == "system":
                prompt += msg["content"] + "\n\n"
            elif msg["role"] == "user":
                prompt += "User: " + msg["content"] + "\n"
            elif msg["role"] == "assistant":
                prompt += "Assistant: " + msg["content"] + "\n"
        prompt = prompt.strip()
        logger.debug(f"Combined prompt: {prompt}")

        # Prepare the payload
        payload = {
            "prompt": prompt,
            "temperature": 0.7,
            "model": model_name
        }

        # Add tools if provided
        if "tools" in kwargs:
            tools = kwargs["tools"]
            logger.debug(f"Tools provided: {tools}")
            # Include tools in the prompt instead of as a separate parameter
            tool_descriptions = []
            for tool in tools:
                if "function" in tool:
                    tool_desc = f"- {tool['function']['name']}: {tool['function']['description']}"
                    if "parameters" in tool["function"]:
                        params = tool["function"]["parameters"]
                        if "properties" in params:
                            param_desc = []
                            for param_name, param_info in params["properties"].items():
                                param_desc.append(f"{param_name} ({param_info.get('type', 'any')})")
                            tool_desc += f" Parameters: {', '.join(param_desc)}"
                    tool_descriptions.append(tool_desc)
            
            if tool_descriptions:
                prompt += "\n\nAvailable tools:\n" + "\n".join(tool_descriptions)
                prompt += "\n\nYou are a helpful assistant that can use tools. When you need to use a tool, you must respond with a JSON object in this exact format:\n"
                prompt += """{
  "role": "assistant",
  "content": null,
  "tool_calls": [{
    "function": {
      "name": "TOOL_NAME",
      "arguments": "{\\"param1\\": value1}"
    },
    "id": "call_123",
    "type": "function"
  }],
  "tool_call_id": null,
  "tool_name": null,
  "response_type": "internal"
}"""

                # Add the user's query
                for msg in messages:
                    if msg["role"] == "user":
                        prompt += f"\n\nUser: {msg['content']}"
                        break

                # Add explicit instruction to use tools
                prompt += "\n\nIMPORTANT: You must use the available tools to help the user. Do not respond with regular text unless you have used all relevant tools first. When using a tool, make sure to use the exact format shown above."
                payload["prompt"] = prompt
                logger.debug(f"Updated prompt with tools: {prompt}")

        logger.debug(f"Final payload with model: {payload}")

        try:
            logger.debug(f"Making async request to {self.api_base}")
            logger.debug(f"Headers: {headers}")
            logger.debug(f"Payload: {payload}")
            
            # Use aiohttp for async requests
            async with aiohttp.ClientSession() as session:
                try:
                    logger.debug("Creating session and preparing request")
                    async with session.post(
                        self.api_base,
                        json=payload,
                        headers=headers,
                        ssl=True,
                        timeout=60,  # Increased timeout
                    ) as response:
                        logger.debug("Request completed")
                        logger.debug(f"Response status: {response.status}")
                        logger.debug(f"Response headers: {dict(response.headers)}")
                        
                        if response.status == 401:
                            logger.error("Authentication failed. Please check your Modal credentials")
                            raise Exception("Authentication failed. Please check your Modal credentials")
                        
                        response.raise_for_status()
                        
                        # Read the response
                        full_response = await response.text()
                        logger.debug(f"Full response: {full_response}")
                        
                        try:
                            # Try to parse the response as JSON
                            response_data = json.loads(full_response)
                            logger.debug(f"Parsed JSON response: {response_data}")
                            
                            # Transform the response to the correct format
                            transformed_data = transform_to_correct_format(full_response)
                            if transformed_data:
                                response_data = transformed_data
                            
                            # Extract the response text
                            if isinstance(response_data, dict):
                                response_text = response_data.get("response", "")
                                # Check for tool calls in the response
                                if "tool_calls" in response_data:
                                    return {
                                        "id": "modal-response",
                                        "choices": [{
                                            "message": {
                                                "role": "assistant",
                                                "content": response_text,
                                                "tool_calls": response_data["tool_calls"]
                                            },
                                            "finish_reason": "tool_calls"
                                        }],
                                        "created": 0,
                                        "model": model,
                                        "usage": {}
                                    }
                            else:
                                response_text = str(response_data)
                        except json.JSONDecodeError:
                            # If not JSON, treat as raw text
                            logger.debug("Response is not JSON, treating as raw text")
                            if "assistant" in full_response.lower():
                                response_text = full_response.split("assistant", 1)[1].strip()
                            else:
                                response_text = full_response.strip()
                            
                            # Remove any remaining user prompt
                            if "user" in response_text.lower():
                                response_text = response_text.split("user", 1)[0].strip()
                        
                        if not response_text:
                            logger.error(f"Unexpected response format: {full_response}")
                            raise Exception("Unexpected response format from Modal API")
                        
                        return {
                            "id": "modal-response",
                            "choices": [{
                                "message": {
                                    "role": "assistant",
                                    "content": response_text
                                },
                                "finish_reason": "stop"
                            }],
                            "created": 0,
                            "model": model,
                            "usage": {}
                        }
                        
                except aiohttp.ClientError as e:
                    logger.error(f"Request failed: {str(e)}")
                    raise Exception(f"Error connecting to Modal API: {str(e)}")
                
        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}")
            raise

    async def astreaming(
        self,
        model: str,
        messages: list,
        model_response: Optional[Dict] = None,
        optional_params: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> AsyncGenerator[Dict, None]:
        logger.debug("Starting async streaming request")
        logger.debug(f"Model: {model}")
        logger.debug(f"Messages: {messages}")
        logger.debug(f"kwargs: {kwargs}")
        logger.debug(f"optional_params: {optional_params}")
        
        # Get credentials from kwargs or environment variables
        token = kwargs.get("api_key") or os.getenv("TOKEN_ID")
        secret = kwargs.get("token_secret") or os.getenv("TOKEN_SECRET")
        
        if not token:
            error_msg = "Missing token. Please provide a valid token."
            logger.error(error_msg)
            raise ValueError(error_msg)

        headers = {
            "Content-Type": "application/json",
            "Modal-Key": token
        }
        
        if secret:
            headers["Modal-Secret"] = secret

        # Extract model name from the input model string
        model_name = model.split("/", 1)[1] if "/" in model else model

        # Combine messages into prompt
        prompt = ""
        for msg in messages:
            if msg["role"] == "system":
                prompt += msg["content"] + "\n\n"
            elif msg["role"] == "user":
                prompt += "User: " + msg["content"] + "\n"
            elif msg["role"] == "assistant":
                prompt += "Assistant: " + msg["content"] + "\n"
        prompt = prompt.strip()

        # Prepare the payload
        payload = {
            "prompt": prompt,
            "temperature": 0.7,
            "model": model_name
        }

        # Add tools if provided
        if "tools" in kwargs:
            tools = kwargs["tools"]
            tool_descriptions = []
            for tool in tools:
                if "function" in tool:
                    tool_desc = f"- {tool['function']['name']}: {tool['function']['description']}"
                    if "parameters" in tool["function"]:
                        params = tool["function"]["parameters"]
                        if "properties" in params:
                            param_desc = []
                            for param_name, param_info in params["properties"].items():
                                param_desc.append(f"{param_name} ({param_info.get('type', 'any')})")
                            tool_desc += f" Parameters: {', '.join(param_desc)}"
                    tool_descriptions.append(tool_desc)
            
            if tool_descriptions:
                prompt += "\n\nAvailable tools:\n" + "\n".join(tool_descriptions)
                prompt += "\n\nYou are a helpful assistant that can use tools. When you need to use a tool, you must respond with a JSON object in this exact format:\n"
                prompt += """{
  "role": "assistant",
  "content": null,
  "tool_calls": [{
    "function": {
      "name": "TOOL_NAME",
      "arguments": "{\\"param1\\": value1}"
    },
    "id": "call_123",
    "type": "function"
  }]
}"""
                payload["prompt"] = prompt

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.api_base,
                    json=payload,
                    headers=headers,
                    ssl=True,
                    timeout=60,
                ) as response:
                    if response.status == 401:
                        raise Exception("Authentication failed. Please check your Modal credentials")
                    
                    response.raise_for_status()
                    full_response = await response.text()
                    
                    try:
                        # Try to parse the response as JSON
                        response_data = json.loads(full_response)
                        
                        # Check if this is a tool call response
                        if isinstance(response_data, dict) and "tool_calls" in response_data:
                            # Yield the tool call response
                            yield {
                                "text": "",
                                "is_finished": True,
                                "finish_reason": "tool_calls",
                                "tool_calls": response_data["tool_calls"],
                                "usage": {
                                    "prompt_tokens": len(prompt.split()),
                                    "completion_tokens": 0,
                                    "total_tokens": len(prompt.split())
                                }
                            }
                            return
                        
                        # If not a tool call, yield the response in chunks
                        response_text = response_data.get("response", str(response_data))
                        chunk_size = 10
                        for i in range(0, len(response_text), chunk_size):
                            chunk = response_text[i:i + chunk_size]
                            is_last_chunk = i + chunk_size >= len(response_text)
                            yield {
                                "text": chunk,
                                "is_finished": is_last_chunk,
                                "finish_reason": "stop" if is_last_chunk else None,
                                "usage": {
                                    "prompt_tokens": len(prompt.split()),
                                    "completion_tokens": len(response_text.split()),
                                    "total_tokens": len(prompt.split()) + len(response_text.split())
                                }
                            }
                    except json.JSONDecodeError:
                        # If not JSON, treat as raw text
                        if "assistant" in full_response.lower():
                            response_text = full_response.split("assistant", 1)[1].strip()
                        else:
                            response_text = full_response.strip()
                        
                        # Remove any remaining user prompt
                        if "user" in response_text.lower():
                            response_text = response_text.split("user", 1)[0].strip()
                        
                        # Try to parse as tool call
                        try:
                            tool_call_data = json.loads(response_text)
                            if isinstance(tool_call_data, dict) and "tool_calls" in tool_call_data:
                                yield {
                                    "text": "",
                                    "is_finished": True,
                                    "finish_reason": "tool_calls",
                                    "tool_calls": tool_call_data["tool_calls"],
                                    "usage": {
                                        "prompt_tokens": len(prompt.split()),
                                        "completion_tokens": 0,
                                        "total_tokens": len(prompt.split())
                                    }
                                }
                                return
                        except json.JSONDecodeError:
                            # Not a tool call, yield as regular text
                            chunk_size = 10
                            for i in range(0, len(response_text), chunk_size):
                                chunk = response_text[i:i + chunk_size]
                                is_last_chunk = i + chunk_size >= len(response_text)
                                yield {
                                    "text": chunk,
                                    "is_finished": is_last_chunk,
                                    "finish_reason": "stop" if is_last_chunk else None,
                                    "usage": {
                                        "prompt_tokens": len(prompt.split()),
                                        "completion_tokens": len(response_text.split()),
                                        "total_tokens": len(prompt.split()) + len(response_text.split())
                                    }
                                }
        except Exception as e:
            logger.error(f"Error in astreaming: {str(e)}")
            raise

def transform_to_correct_format(response):
    """Transform the response into the correct format."""
    if isinstance(response, str):
        response = clean_response(response)
        try:
            # First try to parse as JSON
            try:
                data = json.loads(response)
            except json.JSONDecodeError:
                # If not valid JSON, check if it's a text response that should be a tool call
                # Look for tool markers in the text
                if "[@tool:" in response:
                    # Extract tool name and parameters
                    tool_match = re.search(r'\[@tool:(\w+)\](.*?)(?=\[@tool:|$)', response, re.DOTALL)
                    if tool_match:
                        tool_name = tool_match.group(1)
                        tool_text = tool_match.group(2).strip()
                        
                        # Try to extract parameters from the text
                        # Look for JSON-like structure in the text
                        json_match = re.search(r'\{.*\}', tool_text, re.DOTALL)
                        if json_match:
                            try:
                                params = json.loads(json_match.group(0))
                            except json.JSONDecodeError:
                                # If not valid JSON, try to parse key-value pairs
                                params = {}
                                # Look for key: value or key=value patterns
                                kv_pairs = re.finditer(r'(\w+)\s*[:=]\s*([^,\n]+)', tool_text)
                                for match in kv_pairs:
                                    key = match.group(1).strip()
                                    value = match.group(2).strip()
                                    # Try to convert value to appropriate type
                                    try:
                                        if value.lower() == 'true':
                                            params[key] = True
                                        elif value.lower() == 'false':
                                            params[key] = False
                                        elif value.isdigit():
                                            params[key] = int(value)
                                        elif re.match(r'^-?\d*\.\d+$', value):
                                            params[key] = float(value)
                                        else:
                                            params[key] = value
                                    except ValueError:
                                        params[key] = value
                        
                        # Only create tool call if we found parameters
                        if params:
                            return {
                                "role": "assistant",
                                "content": "",
                                "tool_calls": [{
                                    "function": {
                                        "name": tool_name,
                                        "arguments": json.dumps(params)
                                    },
                                    "id": f"call_{uuid.uuid4().hex[:8]}",
                                    "type": "function"
                                }],
                                "tool_call_id": None,
                                "tool_name": None,
                                "response_type": "internal"
                            }
                return None

            # Handle legacy format with name/parameters
            if "tool_calls" in data:
                tool_calls = []
                for tool_call in data["tool_calls"]:
                    if "name" in tool_call and "parameters" in tool_call:
                        tool_calls.append({
                            "function": {
                                "name": tool_call["name"],
                                "arguments": json.dumps(tool_call["parameters"])
                            },
                            "id": f"call_{uuid.uuid4().hex[:8]}",
                            "type": "function"
                        })
                return {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": tool_calls,
                    "tool_call_id": None,
                    "tool_name": None,
                    "response_type": "internal"
                }

            # If the response is already in the correct format, just fix arguments
            if all(key in data for key in ["role", "content", "tool_calls", "tool_call_id", "tool_name", "response_type"]):
                # Convert null content to empty string
                if data["content"] is None:
                    data["content"] = ""
                for tool_call in data["tool_calls"]:
                    if isinstance(tool_call["function"]["arguments"], dict):
                        tool_call["function"]["arguments"] = json.dumps(tool_call["function"]["arguments"])
                return data

            # If tool_calls is present and is a list, fix arguments if needed
            if "tool_calls" in data and isinstance(data["tool_calls"], list):
                transformed_tool_calls = []
                for tool_call in data["tool_calls"]:
                    if "function" in tool_call and isinstance(tool_call["function"], dict):
                        # Already in function format, just ensure arguments is a string
                        if isinstance(tool_call["function"].get("arguments"), dict):
                            tool_call["function"]["arguments"] = json.dumps(tool_call["function"]["arguments"])
                        transformed_tool_calls.append(tool_call)
                if transformed_tool_calls:  # Only return if we found function format tool calls
                    return {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": transformed_tool_calls,
                        "tool_call_id": None,
                        "tool_name": None,
                        "response_type": "internal"
                    }

        except Exception as e:
            logger.error(f"Error transforming response: {str(e)}")
            logger.error(f"Response data: {data if 'data' in locals() else 'No data'}")
            return None
    return None

def clean_response(response):
    """Clean the response by removing any markers."""
    # Remove any markers
    markers = [
        ("<|python_start|>", "<|python_end|>"),
        ("<|header_start|>", "<|header_end|>"),
        ("<|im_start|>", "<|im_end|>"),
        ("<|assistant|>", "<|user|>")
    ]
    for start, end in markers:
        if start in response and end in response:
            response = response.split(start)[1].split(end)[0]
    return response.strip()

class ModalLLMFactory:
    def __init__(self):
        self.instance = None

    def __call__(self, *args, **kwargs):
        if self.instance is None:
            self.instance = ModalLLM(*args, **kwargs)
        return self.instance

    def completion(self, *args, **kwargs):
        if self.instance is None:
            self.instance = ModalLLM()
        return self.instance.completion(*args, **kwargs)

    def acompletion(self, *args, **kwargs):
        if self.instance is None:
            self.instance = ModalLLM()
        return self.instance.acompletion(*args, **kwargs)

    def astreaming(self, *args, **kwargs):
        if self.instance is None:
            self.instance = ModalLLM()
        return self.instance.astreaming(*args, **kwargs)

modal_llm = ModalLLMFactory() 