import openai
import groq
from anthropic import Anthropic
from typing import List, Dict, Any, Optional
import json
import os
class BaseLLMClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.client = None
    
    def chat_completion(self, 
                       messages: List[Dict[str, str]], 
                       tools: Optional[List[Dict[str, Any]]] = None,
                       temperature: float = 1.0,
                       max_tokens: int = 2048) -> Dict[str, Any]:
        raise NotImplementedError

class OpenAI(BaseLLMClient):
    """OpenAI client implementation using GPT-4o"""
    
    def __init__(self, api_key: str):
        super().__init__(api_key)
        self.client = openai.OpenAI(api_key=api_key)
        self.model = "gpt-4o"
    
    def chat_completion(self, 
                       messages: List[Dict[str, str]], 
                       tools: Optional[List[Dict[str, Any]]] = None,
                       temperature: float = 1.0,
                       max_tokens: int = 2048) -> Dict[str, Any]:
        try:
            kwargs = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens
            }
            
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = "auto"
            
            response = self.client.chat.completions.create(**kwargs)
            
            result = {
                "choices": [{
                    "message": {
                        "role": response.choices[0].message.role,
                        "content": response.choices[0].message.content
                    }
                }],
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                }
            }
            
            if hasattr(response.choices[0].message, "tool_calls") and response.choices[0].message.tool_calls:
                result["choices"][0]["message"]["tool_calls"] = [
                    {
                        "id": tool_call.id,
                        "type": "function",
                        "function": {
                            "name": tool_call.function.name,
                            "arguments": tool_call.function.arguments
                        }
                    }
                    for tool_call in response.choices[0].message.tool_calls
                ]
            
            return result
        except Exception as e:
            raise Exception(f"OpenAI API error: {str(e)}")

class Groq(BaseLLMClient):
    """Groq client implementation using llama-3.3-70b-versatile"""
    
    def __init__(self, api_key: str):
        super().__init__(api_key)
        self.client = groq.Groq(api_key=api_key)
        self.model = "llama-3.3-70b-versatile"
    
    def chat_completion(self, 
                       messages: List[Dict[str, str]], 
                       tools: Optional[List[Dict[str, Any]]] = None,
                       temperature: float = 1.0,
                       max_tokens: int = 2048) -> Dict[str, Any]:
        try:
            kwargs = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens
            }
            
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = "auto"
            
            response = self.client.chat.completions.create(**kwargs)
            
            result = {
                "choices": [{
                    "message": {
                        "role": response.choices[0].message.role,
                        "content": response.choices[0].message.content
                    }
                }],
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                }
            }
            
            if hasattr(response.choices[0].message, "tool_calls") and response.choices[0].message.tool_calls:
                result["choices"][0]["message"]["tool_calls"] = [
                    {
                        "id": tool_call.id,
                        "type": "function",
                        "function": {
                            "name": tool_call.function.name,
                            "arguments": tool_call.function.arguments
                        }
                    }
                    for tool_call in response.choices[0].message.tool_calls
                ]
            
            return result
        except Exception as e:
            raise Exception(f"Groq API error: {str(e)}")

class Claude(BaseLLMClient):
    """Claude client implementation using claude-3-7-sonnet-20250219"""
    
    def __init__(self, api_key: str):
        super().__init__(api_key)
        self.client = Anthropic(api_key=api_key)
        self.model = "claude-3-7-sonnet-20250219"
    
    def chat_completion(self, 
                       messages: List[Dict[str, str]], 
                       tools: Optional[List[Dict[str, Any]]] = None,
                       temperature: float = 1.0,
                       max_tokens: int = 2048) -> Dict[str, Any]:
        try:
            # Claude expects a system prompt separately if present
            system_prompt = next((m["content"] for m in messages if m["role"] == "system"), None)
            user_messages = [m for m in messages if m["role"] != "system"]
            
            # Convert OpenAI-style messages to Claude format
            claude_messages = []
            for msg in user_messages:
                if msg["role"] == "user":
                    claude_messages.append({"role": "user", "content": msg["content"]})
                elif msg["role"] == "assistant":
                    claude_messages.append({"role": "assistant", "content": msg["content"]})

            kwargs = {
                "model": self.model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": claude_messages
            }
            
            if system_prompt:
                kwargs["system"] = system_prompt
            
            if tools:
                # Convert OpenAI tool format to Claude tool format
                claude_tools = [
                    {
                        "name": tool["function"]["name"],
                        "description": tool["function"].get("description", ""),
                        "input_schema": tool["function"]["parameters"]
                    }
                    for tool in tools
                ]
                kwargs["tools"] = claude_tools
            
            response = self.client.messages.create(**kwargs)
            
            # Convert Claude response to OpenAI format
            result = {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": None
                    }
                }],
                "usage": {
                    "prompt_tokens": response.usage.input_tokens,
                    "completion_tokens": response.usage.output_tokens,
                    "total_tokens": response.usage.input_tokens + response.usage.output_tokens
                }
            }
            
            # Handle content (Claude returns content as a list of blocks)
            content_blocks = [block.text for block in response.content if block.type == "text"]
            if content_blocks:
                result["choices"][0]["message"]["content"] = "".join(content_blocks)
            
            # Handle tool calls
            tool_calls = [block for block in response.content if block.type == "tool_use"]
            if tool_calls:
                result["choices"][0]["message"]["tool_calls"] = [
                    {
                        "id": tool_call.id,
                        "type": "function",
                        "function": {
                            "name": tool_call.name,
                            "arguments": json.dumps(tool_call.input)  # Convert dict to JSON string
                        }
                    }
                    for tool_call in tool_calls
                ]
            
            return result
        except Exception as e:
            raise Exception(f"Claude API error: {str(e)}")

# Example usage:
if __name__ == "__main__":
    openai_api_key = os.getenv("OPENAI_API_KEY")
    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
    groq_api_key = os.getenv("GROQ_API_KEY")
    try:
        # OpenAI example (unchanged)
        openai_client = OpenAI(openai_api_key)
        #messages = [{"role": "user", "content": "Hello!"}]
        #response = openai_client.chat_completion(messages)
        #print("OpenAI response:", response)

        # Groq example (unchanged)
        groq_client = Groq(groq_api_key)
        #response = groq_client.chat_completion(messages)
        #print("Groq response:", response)

        # Claude example
        claude_client = Claude(anthropic_api_key)
        #response = claude_client.chat_completion(messages)
        #print("Claude response:", response)

        # Tool example
        tools = [{
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get the current weather",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {"type": "string"}
                    }
                }
            }
        }]
        messages_with_tools = [{"role": "user", "content": "What's the weather like in New York?"}]
        response = claude_client.chat_completion(messages_with_tools, tools=tools)
        print("Claude tool response:", response)

        # Example with OpenAI
  
        response = openai_client.chat_completion(messages_with_tools, tools=tools)
        print("OpenAI tool response:", response)

        # Example with Groq
        response = groq_client.chat_completion(messages_with_tools, tools=tools)
        print("Groq tool response:", response)

    except Exception as e:
        print(f"Error: {e}")