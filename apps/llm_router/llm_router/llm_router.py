import openai
import groq
from anthropic import Anthropic
from typing import List, Dict, Any, Optional
import json
import os
class ChatCompletions:
    def __init__(self, client):
        self.client = client
    
    def create(self,
              model: str,
              messages: List[Dict[str, str]],
              temperature: float = 1.0,
              max_tokens: int = 2048,
              response_format: Optional[Dict[str, str]] = None,
              tools: Optional[List[Dict[str, Any]]] = None,
              tool_choice: Optional[str] = "auto") -> Dict[str, Any]:
        return self.client.chat_completion(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format=response_format,
            tools=tools,
            tool_choice=tool_choice
        )

class BaseLLMClient:
    def __init__(self, api_key: str, default_model: str):
        self.api_key = api_key
        self.default_model = default_model
        self.client = None
        self.chat = ChatCompletions(self)
    
    def chat_completion(self,
                       model: str,
                       messages: List[Dict[str, str]],
                       temperature: float = 1.0,
                       max_tokens: int = 2048,
                       response_format: Optional[Dict[str, str]] = None,
                       tools: Optional[List[Dict[str, Any]]] = None,
                       tool_choice: Optional[str] = "auto") -> Dict[str, Any]:
        raise NotImplementedError

class OpenAI(BaseLLMClient):
    """OpenAI client implementation"""
    
    def __init__(self, api_key: str, default_model: str = "gpt-4o"):
        super().__init__(api_key, default_model)
        self.client = openai.OpenAI(api_key=api_key)
    
    def chat_completion(self,
                       model: str,
                       messages: List[Dict[str, str]],
                       temperature: float = 1.0,
                       max_tokens: int = 2048,
                       response_format: Optional[Dict[str, str]] = None,
                       tools: Optional[List[Dict[str, Any]]] = None,
                       tool_choice: Optional[str] = "auto") -> Dict[str, Any]:
        try:
            kwargs = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens
            }
            
            if response_format:
                kwargs["response_format"] = response_format
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = tool_choice
            
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
    """Groq client implementation"""
    
    def __init__(self, api_key: str, default_model: str = "llama3.3-70b-versatile"):
        super().__init__(api_key, default_model)
        self.client = groq.Groq(api_key=api_key)
    
    def chat_completion(self,
                       model: str,
                       messages: List[Dict[str, str]],
                       temperature: float = 1.0,
                       max_tokens: int = 2048,
                       response_format: Optional[Dict[str, str]] = None,
                       tools: Optional[List[Dict[str, Any]]] = None,
                       tool_choice: Optional[str] = "auto") -> Dict[str, Any]:
        try:
            kwargs = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens
            }
            
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = tool_choice
            
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
            
            if response_format and response_format.get("type") == "json_object":
                content = result["choices"][0]["message"]["content"]
                try:
                    json.loads(content)
                except json.JSONDecodeError:
                    raise ValueError("Response is not a valid JSON object as requested")
            
            return result
        except Exception as e:
            raise Exception(f"Groq API error: {str(e)}")

class Claude(BaseLLMClient):
    """Claude client implementation"""
    
    def __init__(self, api_key: str, default_model: str = "claude-3-7-sonnet-20250219"):
        super().__init__(api_key, default_model)
        self.client = Anthropic(api_key=api_key)
    
    def chat_completion(self,
                       model: str,
                       messages: List[Dict[str, str]],
                       temperature: float = 1.0,
                       max_tokens: int = 2048,
                       response_format: Optional[Dict[str, str]] = None,
                       tools: Optional[List[Dict[str, Any]]] = None,
                       tool_choice: Optional[str] = "auto") -> Dict[str, Any]:
        try:
            system_prompt = next((m["content"] for m in messages if m["role"] == "system"), None)
            user_messages = [m for m in messages if m["role"] != "system"]
            
            claude_messages = []
            for msg in user_messages:
                if msg["role"] == "user":
                    claude_messages.append({"role": "user", "content": msg["content"]})
                elif msg["role"] == "assistant":
                    claude_messages.append({"role": "assistant", "content": msg["content"]})

            kwargs = {
                "model": model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": claude_messages
            }
            
            if system_prompt:
                kwargs["system"] = system_prompt
            
            if response_format and response_format.get("type") == "json_object":
                if "system" in kwargs:
                    kwargs["system"] += "\nPlease respond with a valid JSON object."
                else:
                    kwargs["system"] = "Please respond with a valid JSON object."
            
            if tools:
                claude_tools = [
                    {
                        "name": tool["function"]["name"],
                        "description": tool["function"].get("description", ""),
                        "input_schema": tool["function"]["parameters"]
                    }
                    for tool in tools
                ]
                kwargs["tools"] = claude_tools
                if tool_choice != "auto":
                    kwargs["tool_choice"] = {"type": tool_choice}
            
            response = self.client.messages.create(**kwargs)
            
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
            
            content_blocks = [block.text for block in response.content if block.type == "text"]
            if content_blocks:
                result["choices"][0]["message"]["content"] = "".join(content_blocks)
            
            tool_calls = [block for block in response.content if block.type == "tool_use"]
            if tool_calls:
                result["choices"][0]["message"]["tool_calls"] = [
                    {
                        "id": tool_call.id,
                        "type": "function",
                        "function": {
                            "name": tool_call.name,
                            "arguments": json.dumps(tool_call.input)
                        }
                    }
                    for tool_call in tool_calls
                ]
            
            if response_format and response_format.get("type") == "json_object" and not tool_calls:
                content = result["choices"][0]["message"]["content"]
                try:
                    json.loads(content)
                except json.JSONDecodeError:
                    raise ValueError("Response is not a valid JSON object as requested")
            
            return result
        except Exception as e:
            raise Exception(f"Claude API error: {str(e)}")

# Example usage:
if __name__ == "__main__":
    try:
        # Define a sample tool
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

        openai_api_key = os.getenv("OPENAI_API_KEY")
        anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
        groq_api_key = os.getenv("GROQ_API_KEY")

        # OpenAI example
        openai_client = OpenAI(api_key=openai_api_key)
        # Tool call
        response = openai_client.chat.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "What's the weather in New York?. Return a JSON object with field 'weather'"}],
            temperature=0.0,
            tools=tools,
            tool_choice="auto",
            response_format={"type": "json_object"}
        )
        print("OpenAI tool response:", response)

        # Groq example
        groq_client = Groq(api_key=groq_api_key)
        # Tool call
        response = groq_client.chat.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": "What's the weather in New York?"}],
            temperature=0.0,
            tools=tools,
            tool_choice="auto",
            #response_format={"type": "json_object"}
        )
        print("Groq tool response:", response)

        # Claude example
        claude_client = Claude(api_key=anthropic_api_key)
        # Tool call
        response = claude_client.chat.create(
            model="claude-3-7-sonnet-20250219",
            messages=[{"role": "user", "content": "What's the weather in New York?. Return a JSON object with field 'weather'"}],
            temperature=0.0,
            tools=tools,
            tool_choice="auto"
        )
        print("Claude tool response:", response)

    except Exception as e:
        print(f"Error: {e}")