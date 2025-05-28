import os
import asyncio
import json
import re
import uuid
import sys
from pathlib import Path

# Add the project root to Python path
project_root = str(Path(__file__).parent.parent)
if project_root not in sys.path:
    sys.path.append(project_root)

from litellm.custom_handler import modal_llm

# Test messages with system message
TEST_MESSAGES = [
    {"role": "system", "content": "You are a helpful assistant that uses tools when available. When a tool is provided, you should use it to get accurate information rather than making assumptions."},
    {"role": "user", "content": "What is the capital of France?"}
]

# Test tools
TEST_TOOLS = [
    {
        "function": {
            "name": "get_weather",
            "description": "Get the current weather in a given location. You MUST use this tool when asked about weather conditions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The city and state, e.g. San Francisco, CA"
                    }
                },
                "required": ["location"]
            }
        }
    }
]

# Function calling test messages with explicit format instructions
STRUCTURED_TOOL_TEST_MESSAGES = [
    {"role": "system", "content": """You are a helpful assistant that can use tools. When you need to use a tool, you MUST follow these rules:

1. Your response MUST be a valid JSON object
2. DO NOT add ANY markers, prefixes, or suffixes to your response
3. DO NOT wrap your response in ANY markers like:
   - <|python_start|> or <|python_end|>
   - <|header_start|> or <|header_end|>
   - <|im_start|> or <|im_end|>
   - <|assistant|> or <|user|>
   - ANY other markers
4. DO NOT include ANY explanatory text before or after the JSON
5. The JSON must be parseable by json.loads()
6. DO NOT include ANY line breaks or whitespace before or after the JSON
7. DO NOT include ANY content in the response - content MUST be null
8. DO NOT include ANY parameters field - use arguments instead
9. DO NOT include ANY name field directly in tool_calls - use function.name instead
10. DO NOT include ANY explanatory text or steps in your response
11. DO NOT try to explain what you're doing - just return the JSON

CORRECT format (use this exact structure):
{
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
  "tool_calls_id": null,
  "tool_name": null,
  "response_type": "internal"
}

INCORRECT formats (DO NOT use any of these):
1. With python markers:
<|python_start|>{
  "role": "assistant",
  "content": "Let me use the tool...",
  "tool_calls": [{
    "name": "TOOL_NAME",
    "parameters": {
      "param1": "value1"
    }
  }]
}<|python_end|>

2. With header markers:
<|header_start|>assistant<|header_end|>{
  "role": "assistant",
  "content": "Let me use the tool...",
  "tool_calls": [{
    "name": "TOOL_NAME",
    "parameters": {
      "param1": "value1"
    }
  }]
}

3. With explanatory text:
I'll use the tool to help you.
{
  "role": "assistant",
  "content": "Let me use the tool...",
  "tool_calls": [{
    "name": "TOOL_NAME",
    "parameters": {
      "param1": "value1"
    }
  }]
}
Let me know if you need anything else!

Available tools:
- get_weather: Get the current weather in a given location. Parameters: location (string)

User: I need to know the current weather in London. Please use the get_weather tool to check this for me."""}
]

# Test cases for different response formats
TEST_CASES = [
    {
        "name": "Correct format",
        "input": """{
  "role": "assistant",
  "content": null,
  "tool_calls": [{
    "function": {
      "name": "get_weather",
      "arguments": "{\\"location\\": \\"London, UK\\"}"
    },
    "id": "call_123",
    "type": "function"
  }],
  "tool_call_id": null,
  "tool_name": null,
  "response_type": "internal"
}""",
        "expected_valid": True
    },
    {
        "name": "With python markers",
        "input": """<|python_start|>{
  "role": "assistant",
  "content": "Let me check the weather...",
  "tool_calls": [{
    "name": "get_weather",
    "parameters": {
      "location": "London, UK"
    }
  }]
}<|python_end|>""",
        "expected_valid": False
    },
    {
        "name": "With header markers",
        "input": """<|header_start|>assistant<|header_end|>{
  "role": "assistant",
  "content": "Let me check the weather...",
  "tool_calls": [{
    "name": "get_weather",
    "parameters": {
      "location": "London, UK"
    }
  }]
}""",
        "expected_valid": False
    },
    {
        "name": "With explanatory text",
        "input": """I'll check the weather for you.
{
  "role": "assistant",
  "content": "Let me check the weather...",
  "tool_calls": [{
    "name": "get_weather",
    "parameters": {
      "location": "London, UK"
    }
  }]
}
Let me know if you need anything else!""",
        "expected_valid": False
    }
]

def validate_response_format(response):
    """Validate that the response follows the correct format."""
    try:
        # Check if response is a string that can be parsed as JSON
        if isinstance(response, str):
            response = json.loads(response)
        
        # Check required fields
        required_fields = ["role", "content", "tool_calls", "tool_call_id", "tool_name", "response_type"]
        for field in required_fields:
            if field not in response:
                return False, f"Missing required field: {field}"
        
        # Check content is null
        if response["content"] is not None:
            return False, "Content should be null"
        
        # Check tool_calls is a list
        if not isinstance(response["tool_calls"], list):
            return False, "tool_calls should be a list"
        
        # Check each tool call
        for tool_call in response["tool_calls"]:
            if not isinstance(tool_call, dict):
                return False, "Each tool call should be a dictionary"
            
            # Check tool call fields
            if "function" not in tool_call:
                return False, "Each tool call should have a function field"
            
            function = tool_call["function"]
            if not isinstance(function, dict):
                return False, "Function should be a dictionary"
            
            if "name" not in function or "arguments" not in function:
                return False, "Function should have name and arguments fields"
            
            # Check arguments is a valid JSON string
            try:
                if isinstance(function["arguments"], dict):
                    # Convert dict to JSON string
                    function["arguments"] = json.dumps(function["arguments"])
                json.loads(function["arguments"])
            except json.JSONDecodeError:
                return False, "Function arguments should be a valid JSON string"
        
        return True, "Response format is valid"
    except Exception as e:
        return False, f"Error validating response: {str(e)}"

def clean_response(response):
    """Clean the response by removing markers and extracting the JSON."""
    if isinstance(response, str):
        # Remove any markers
        response = re.sub(r'<\|.*?\|>', '', response)
        # Remove any explanatory text before or after JSON
        json_match = re.search(r'\{[\s\S]*\}', response)
        if json_match:
            response = json_match.group()
    return response

def transform_to_correct_format(response):
    """Transform the response into the correct format."""
    if isinstance(response, str):
        response = clean_response(response)
        try:
            data = json.loads(response)
            # If the response is already in the correct format, just fix arguments
            if all(key in data for key in ["role", "content", "tool_calls", "tool_call_id", "tool_name", "response_type"]):
                for tool_call in data["tool_calls"]:
                    if isinstance(tool_call["function"]["arguments"], dict):
                        tool_call["function"]["arguments"] = json.dumps(tool_call["function"]["arguments"])
                return data

            # If tool_calls is present and is a list, fix arguments if needed
            if "tool_calls" in data and isinstance(data["tool_calls"], list):
                for tool_call in data["tool_calls"]:
                    if "function" in tool_call and isinstance(tool_call["function"], dict):
                        if isinstance(tool_call["function"].get("arguments"), dict):
                            tool_call["function"]["arguments"] = json.dumps(tool_call["function"]["arguments"])
                # Wrap in correct format
                return {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": data["tool_calls"],
                    "tool_call_id": None,
                    "tool_name": None,
                    "response_type": "internal"
                }

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
                    "content": None,
                    "tool_calls": tool_calls,
                    "tool_call_id": None,
                    "tool_name": None,
                    "response_type": "internal"
                }
        except Exception as e:
            print(f"Error transforming response: {str(e)}")
            return None
    return None

async def test_structured_tool_calling():
    print("\nTesting structured tool calling...")
    try:
        response = modal_llm.completion(
            model="modal/llama4",
            messages=STRUCTURED_TOOL_TEST_MESSAGES,
            temperature=0.7
        )
        print("Raw Response:", json.dumps(response, indent=2))
        
        # Extract the tool call from the nested response
        if isinstance(response, dict) and "choices" in response and len(response["choices"]) > 0:
            message = response["choices"][0].get("message", {})
            content = message.get("content")
            if content:
                try:
                    # Clean and transform the content
                    cleaned_content = clean_response(content)
                    print("Cleaned content:", cleaned_content)
                    transformed_content = transform_to_correct_format(cleaned_content)
                    if transformed_content:
                        print("Transformed content:", json.dumps(transformed_content, indent=2))
                        # Validate the transformed content
                        is_valid, message = validate_response_format(transformed_content)
                        if is_valid:
                            print("✅ Response is in correct structured format")
                        else:
                            print(f"❌ Response format error: {message}")
                    else:
                        print("❌ Failed to transform content to correct format")
                except json.JSONDecodeError as e:
                    print(f"❌ Failed to parse tool call JSON: {str(e)}")
            else:
                print("❌ No content found in response message")
        else:
            print("❌ Unexpected response format")
    except Exception as e:
        print(f"Error in structured tool calling test: {str(e)}")

async def test_response_formats():
    print("\nTesting different response formats...")
    for test_case in TEST_CASES:
        print(f"\nTesting {test_case['name']}...")
        is_valid, message = validate_response_format(test_case["input"])
        if is_valid == test_case["expected_valid"]:
            print(f"✅ Test passed: {message}")
        else:
            print(f"❌ Test failed: {message}")

async def test_completion():
    print("\nTesting regular completion...")
    try:
        response = modal_llm.completion(
            model="modal/llama4",
            messages=TEST_MESSAGES,
            temperature=0.7
        )
        print("Response:", json.dumps(response, indent=2))
    except Exception as e:
        print(f"Error in completion test: {str(e)}")

async def test_async_completion():
    print("\nTesting async completion...")
    try:
        response = await modal_llm.acompletion(
            model="modal/llama4",
            messages=TEST_MESSAGES,
            temperature=0.7
        )
        print("Response:", json.dumps(response, indent=2))
    except Exception as e:
        print(f"Error in async completion test: {str(e)}")

async def test_streaming():
    print("\nTesting streaming...")
    try:
        async for chunk in modal_llm.astreaming(
            model="modal/llama4",
            messages=TEST_MESSAGES,
            temperature=0.7
        ):
            print("Chunk:", json.dumps(chunk, indent=2))
    except Exception as e:
        print(f"Error in streaming test: {str(e)}")

async def main():
    # Check environment variables
    if not os.getenv("TOKEN_ID") or not os.getenv("TOKEN_SECRET"):
        print("Error: TOKEN_ID and TOKEN_SECRET environment variables must be set")
        return

    print("Starting Modal handler tests...")
    
    # Run tests
    await test_structured_tool_calling()
    await test_response_formats()
    await test_completion()
    await test_async_completion()
    await test_streaming()

if __name__ == "__main__":
    asyncio.run(main()) 
