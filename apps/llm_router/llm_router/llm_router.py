# llm_router.py

import openai
import groq
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
            
            # Standardize response format to OpenAI's structure
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
                            "arguments": tool_call.function.arguments  # Already a JSON string in OpenAI
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
            
            # Convert Groq response to exact OpenAI format
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
                # Transform Groq tool calls to match OpenAI's exact structure
                result["choices"][0]["message"]["tool_calls"] = [
                    {
                        "id": tool_call.id,
                        "type": "function",
                        "function": {
                            "name": tool_call.function.name,
                            "arguments": tool_call.function.arguments  # Already a JSON string in Groq
                        }
                    }
                    for tool_call in response.choices[0].message.tool_calls
                ]
            
            return result
        except Exception as e:
            raise Exception(f"Groq API error: {str(e)}")

# Example usage:
if __name__ == "__main__":
    # Example with OpenAI
    openai_api_key = os.getenv("OPENAI_API_KEY")
    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
    groq_api_key = os.getenv("GROQ_API_KEY")
    try:
        openai_client = OpenAI(openai_api_key)
        
        # Regular chat completion
        messages = [{"role": "user", "content": "Hello, how are you?"}]
        response = openai_client.chat_completion(messages)
        print("OpenAI response:", response)
        
        # With tools
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
        response = openai_client.chat_completion(messages_with_tools, tools=tools)
        print("OpenAI tool response:", response)
        
    except Exception as e:
        print(f"Error: {e}")
    
    # Example with Groq
    try:
        groq_client = Groq(groq_api_key)
        
        # Regular chat completion
        messages = [{"role": "user", "content": "Hello, how are you?"}]
        response = groq_client.chat_completion(messages)
        print("Groq response:", response)
        
        # With tools
        response = groq_client.chat_completion(messages_with_tools, tools=tools)
        print("Groq tool response:", response)
        
    except Exception as e:
        print(f"Error: {e}")
        
        
