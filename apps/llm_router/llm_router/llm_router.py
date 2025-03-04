import openai
import groq
from anthropic import Anthropic
from typing import List, Dict, Any, Optional, Iterator
import json
import os

class ChatCompletions:
    def __init__(self, llm_client):
        self.llm_client = llm_client
    
    def create(self,
               model: str,
               messages: List[Dict[str, str]],
               temperature: float = 1.0,
               max_tokens: int = 2048,
               response_format: Optional[Dict[str, str]] = None,
               tools: Optional[List[Dict[str, Any]]] = None,
               tool_choice: Optional[str] = "auto",
               stream: bool = False,
               parallel_tool_calls: bool = True) -> Dict[str, Any] | Iterator[Dict[str, Any]]:
        return self.llm_client.chat_completion(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format=response_format,
            tools=tools,
            tool_choice=tool_choice,
            stream=stream,
            parallel_tool_calls=parallel_tool_calls
        )

class Chat:
    def __init__(self, llm_client):
        self.completions = ChatCompletions(llm_client)

class BaseLLMClient:
    def __init__(self, api_key: str, default_model: str):
        self.api_key = api_key
        self.default_model = default_model
        self.provider_client = None  # To be set by subclasses
        self.chat = Chat(self)  # Sets up chat.completions structure
    
    def chat_completion(self,
                        model: str,
                        messages: List[Dict[str, str]],
                        temperature: float = 1.0,
                        max_tokens: int = 2048,
                        response_format: Optional[Dict[str, str]] = None,
                        tools: Optional[List[Dict[str, Any]]] = None,
                        tool_choice: Optional[str] = "auto",
                        stream: bool = False,
                        parallel_tool_calls: bool = True) -> Dict[str, Any] | Iterator[Dict[str, Any]]:
        raise NotImplementedError("Subclasses must implement chat_completion")

class OpenAI(BaseLLMClient):
    """OpenAI client implementation"""
    
    def __init__(self, api_key: str, default_model: str = "gpt-4o"):
        super().__init__(api_key, default_model)
        self.provider_client = openai.OpenAI(api_key=api_key)
    
    def chat_completion(self,
                        model: str,
                        messages: List[Dict[str, str]],
                        temperature: float = 1.0,
                        max_tokens: int = 2048,
                        response_format: Optional[Dict[str, str]] = None,
                        tools: Optional[List[Dict[str, Any]]] = None,
                        tool_choice: Optional[str] = "auto",
                        stream: bool = False,
                        parallel_tool_calls: bool = True) -> Dict[str, Any] | Iterator[Dict[str, Any]]:
        try:
            kwargs = {
                "model": model or self.default_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": stream
            }
            
            if response_format:
                kwargs["response_format"] = response_format
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = tool_choice
                kwargs["parallel_tool_calls"] = parallel_tool_calls
            
            response = self.provider_client.chat.completions.create(**kwargs)
            
            if stream:
                def stream_generator():
                    for chunk in response:
                        result = {
                            "choices": [{
                                "delta": {
                                    "role": chunk.choices[0].delta.role if chunk.choices[0].delta.role else "assistant",
                                    "content": chunk.choices[0].delta.content if chunk.choices[0].delta.content else ""
                                }
                            }]
                        }
                        if hasattr(chunk.choices[0].delta, "tool_calls") and chunk.choices[0].delta.tool_calls:
                            result["choices"][0]["delta"]["tool_calls"] = [
                                {
                                    "id": tool_call.id,
                                    "type": "function",
                                    "function": {
                                        "name": tool_call.function.name,
                                        "arguments": tool_call.function.arguments or ""
                                    }
                                }
                                for tool_call in chunk.choices[0].delta.tool_calls
                            ]
                        yield result
                return stream_generator()
            
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
                    "total_tokens": response.usage.total_tokens,
                    "input_tokens": response.usage.prompt_tokens,      # Added input_tokens
                    "output_tokens": response.usage.completion_tokens  # Added output_tokens
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
        self.provider_client = groq.Groq(api_key=api_key)
    
    def chat_completion(self,
                        model: str,
                        messages: List[Dict[str, str]],
                        temperature: float = 1.0,
                        max_tokens: int = 2048,
                        response_format: Optional[Dict[str, str]] = None,
                        tools: Optional[List[Dict[str, Any]]] = None,
                        tool_choice: Optional[str] = "auto",
                        stream: bool = False,
                        parallel_tool_calls: bool = True) -> Dict[str, Any] | Iterator[Dict[str, Any]]:
        try:
            kwargs = {
                "model": model or self.default_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": stream
            }
            
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = tool_choice
                kwargs["parallel_tool_calls"] = parallel_tool_calls
            
            response = self.provider_client.chat.completions.create(**kwargs)
            
            if stream:
                def stream_generator():
                    for chunk in response:
                        result = {
                            "choices": [{
                                "delta": {
                                    "role": chunk.choices[0].delta.role if chunk.choices[0].delta.role else "assistant",
                                    "content": chunk.choices[0].delta.content if chunk.choices[0].delta.content else ""
                                }
                            }]
                        }
                        if hasattr(chunk.choices[0].delta, "tool_calls") and chunk.choices[0].delta.tool_calls:
                            result["choices"][0]["delta"]["tool_calls"] = [
                                {
                                    "id": tool_call.id,
                                    "type": "function",
                                    "function": {
                                        "name": tool_call.function.name,
                                        "arguments": tool_call.function.arguments or ""
                                    }
                                }
                                for tool_call in chunk.choices[0].delta.tool_calls
                            ]
                        yield result
                return stream_generator()
            
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
                    "total_tokens": response.usage.total_tokens,
                    "input_tokens": response.usage.prompt_tokens,      # Added input_tokens
                    "output_tokens": response.usage.completion_tokens  # Added output_tokens
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
        self.provider_client = Anthropic(api_key=api_key)
    
    def chat_completion(self,
                        model: str,
                        messages: List[Dict[str, str]],
                        temperature: float = 1.0,
                        max_tokens: int = 2048,
                        response_format: Optional[Dict[str, str]] = None,
                        tools: Optional[List[Dict[str, Any]]] = None,
                        tool_choice: Optional[str] = "auto",
                        stream: bool = False,
                        parallel_tool_calls: bool = True) -> Dict[str, Any]:
        if stream:
            raise NotImplementedError("Streaming is not supported by Claude's API in this implementation")
        
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
                "model": model or self.default_model,
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
                # parallel_tool_calls is ignored by Claude
            
            response = self.provider_client.messages.create(**kwargs)
            
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
                    "total_tokens": response.usage.input_tokens + response.usage.output_tokens,
                    "input_tokens": response.usage.input_tokens,      # Added input_tokens
                    "output_tokens": response.usage.output_tokens     # Added output_tokens
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
        # Non-streaming tool call with parallel_tool_calls
        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "What's the weather in New York and San Francisco?. Return a JSON object with field 'weather'."}],
            temperature=0.0,
            tools=tools,
            tool_choice="auto",
            response_format={"type": "json_object"},
            parallel_tool_calls=True
        )
        print("OpenAI non-streaming response:", response)
        print("OpenAI input tokens:", response["usage"]["input_tokens"])
        print("OpenAI output tokens:", response["usage"]["output_tokens"])
        # Streaming example
        stream_response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Tell me a story"}],
            temperature=0.0,
            stream=True
        )
        #print("OpenAI streaming response:")
        #for chunk in stream_response:
        #    print(chunk["choices"][0]["delta"]["content"], end="", flush=True)
        #print("\n")

        # Groq example
        groq_client = Groq(api_key=groq_api_key)
        # Non-streaming tool call with parallel_tool_calls
        response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": "What's the weather in New York and San Francisco?"}],
            temperature=0.0,
            tools=tools,
            tool_choice="auto",
            parallel_tool_calls=True
        )
        print("Groq non-streaming response:", response)
        print("Groq input tokens:", response["usage"]["input_tokens"])
        print("Groq output tokens:", response["usage"]["output_tokens"])
        # Streaming example
        stream_response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": "Tell me a story"}],
            temperature=0.0,
            stream=True
        )
        print("Groq streaming response:")
        for chunk in stream_response:
            print(chunk["choices"][0]["delta"]["content"], end="", flush=True)
        print("\n")

        # Claude example
        claude_client = Claude(api_key=anthropic_api_key)
        # Non-streaming tool call (parallel_tool_calls ignored)
        response = claude_client.chat.completions.create(
            model="claude-3-7-sonnet-20250219",
            messages=[{"role": "user", "content": "What's the weather in New York and San Francisco?"}],
            temperature=0.0,
            tools=tools,
            tool_choice="auto",
            parallel_tool_calls=True  # Ignored by Claude
        )
        print("Claude non-streaming response:", response)
        print("Claude input tokens:", response["usage"]["input_tokens"])
        print("Claude output tokens:", response["usage"]["output_tokens"])

    except Exception as e:
        print(f"Error: {e}")