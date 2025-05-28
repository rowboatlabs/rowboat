import json
import re
import uuid
import pytest

def clean_response(response):
    """Clean the response by removing markers and extracting the JSON."""
    if isinstance(response, str):
        # Remove any markers - be more aggressive about this
        markers = [
            r'<\|python_start\|>', r'<\|python_end\|>',
            r'<\|header_start\|>', r'<\|header_end\|>',
            r'<\|im_start\|>', r'<\|im_end\|>',
            r'<\|assistant\|>', r'<\|user\|>',
            r'<\|.*?\|>'  # Catch any other markers
        ]
        for marker in markers:
            response = re.sub(marker, '', response, flags=re.IGNORECASE)
        
        # Remove any explanatory text before or after JSON
        json_match = re.search(r'\{[\s\S]*\}', response)
        if json_match:
            response = json_match.group()
            
        # Remove any remaining whitespace or newlines
        response = response.strip()
        
        print(f"Cleaned response: {response}")
        return response
    return response

def transform_to_correct_format(response):
    """Transform the response into the correct format."""
    if isinstance(response, str):
        response = clean_response(response)
        try:
            # First try to parse as JSON
            try:
                data = json.loads(response)
            except json.JSONDecodeError:
                print("Response is not valid JSON")
                return None

            # Handle legacy format with name/parameters first
            if "tool_calls" in data and isinstance(data["tool_calls"], list):
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
                if tool_calls:  # Only return if we found legacy format tool calls
                    return {
                        "role": "assistant",
                        "content": "",  # Empty string instead of null
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
                        "content": "",  # Empty string instead of null
                        "tool_calls": transformed_tool_calls,
                        "tool_call_id": None,
                        "tool_name": None,
                        "response_type": "internal"
                    }

        except Exception as e:
            print(f"Error transforming response: {str(e)}")
            print(f"Response data: {data if 'data' in locals() else 'No data'}")
            return None
    return None

class TestLLMTransformation:
    def test_clean_response(self):
        """Test cleaning of response with markers."""
        response = '<|python_start|>{"role": "assistant", "content": "test"}</|python_end|>'
        cleaned = clean_response(response)
        assert cleaned == '{"role": "assistant", "content": "test"}'

    def test_transform_valid_json(self):
        """Test transformation of valid JSON response."""
        response = {
            "role": "assistant",
            "content": None,
            "tool_calls": [{
                "function": {
                    "name": "companies_house_lookup",
                    "arguments": {"company_name": "Test Company"}
                },
                "id": "call_123",
                "type": "function"
            }],
            "tool_call_id": None,
            "tool_name": None,
            "response_type": "internal"
        }
        transformed = transform_to_correct_format(json.dumps(response))
        assert transformed is not None
        assert transformed["content"] == ""
        assert transformed["tool_calls"][0]["function"]["name"] == "companies_house_lookup"
        assert json.loads(transformed["tool_calls"][0]["function"]["arguments"]) == {"company_name": "Test Company"}

    def test_transform_legacy_format(self):
        """Test transformation of legacy format with name/parameters."""
        response = {
            "role": "assistant",
            "content": None,
            "tool_calls": [{
                "name": "companies_house_lookup",
                "parameters": {"company_name": "Test Company"}
            }],
            "tool_call_id": None,
            "tool_name": None,
            "response_type": "internal"
        }
        transformed = transform_to_correct_format(json.dumps(response))
        assert transformed is not None
        assert transformed["tool_calls"][0]["function"]["name"] == "companies_house_lookup"
        assert json.loads(transformed["tool_calls"][0]["function"]["arguments"]) == {"company_name": "Test Company"}

    def test_transform_invalid_json(self):
        """Test handling of invalid JSON."""
        response = "This is not valid JSON"
        transformed = transform_to_correct_format(response)
        assert transformed is None

    def test_transform_with_multiple_tools(self):
        """Test transformation with multiple tool calls."""
        response = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "function": {
                        "name": "companies_house_lookup",
                        "arguments": {"company_name": "Test Company 1"}
                    },
                    "id": "call_123",
                    "type": "function"
                },
                {
                    "function": {
                        "name": "mortgage_calculator",
                        "arguments": {
                            "principal": 200000,
                            "annual_rate": 0.05,
                            "term_years": 25,
                            "calculate": "monthly_payment"
                        }
                    },
                    "id": "call_456",
                    "type": "function"
                }
            ],
            "tool_call_id": None,
            "tool_name": None,
            "response_type": "internal"
        }
        transformed = transform_to_correct_format(json.dumps(response))
        assert transformed is not None
        assert len(transformed["tool_calls"]) == 2
        assert transformed["tool_calls"][0]["function"]["name"] == "companies_house_lookup"
        assert transformed["tool_calls"][1]["function"]["name"] == "mortgage_calculator"
        assert json.loads(transformed["tool_calls"][0]["function"]["arguments"]) == {"company_name": "Test Company 1"}
        assert json.loads(transformed["tool_calls"][1]["function"]["arguments"]) == {
            "principal": 200000,
            "annual_rate": 0.05,
            "term_years": 25,
            "calculate": "monthly_payment"
        } 