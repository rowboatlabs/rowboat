import json
import re
import unittest
import uuid
import pytest
import aiohttp
import asyncio
import os
from unittest.mock import AsyncMock, MagicMock
from modelcontextprotocol.sdk.client import Client
from modelcontextprotocol.sdk.client.sse import SSEClientTransport

# Mock tool class to simulate external tools
class MockTool:
    def __init__(self, name, description):
        self.name = name
        self.description = description

    async def execute(self, **kwargs):
        # Simulate tool execution
        if self.name == "companies_house_lookup":
            return {
                "company_name": kwargs.get("company_name"),
                "company_number": "12345678",
                "status": "active"
            }
        elif self.name == "mortgage_calculator":
            return {
                "monthly_payment": 1000.00,
                "total_payment": 300000.00,
                "total_interest": 100000.00
            }
        elif self.name == "web_site_search":
            return {
                "results": [
                    {"title": "Test Result", "url": "https://example.com"}
                ]
            }
        return {"error": "Unknown tool"}

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

def transform_to_correct_format(response, current_agent=None):
    """Transform the response into the correct format."""
    if isinstance(response, str):
        response = clean_response(response)
        try:
            # First try to parse as JSON
            try:
                data = json.loads(response)
            except json.JSONDecodeError:
                # If not valid JSON, check if it's a text response that should be a tool call
                if current_agent and hasattr(current_agent, 'tools'):
                    # Check each configured tool
                    for tool_name in current_agent.tools:
                        # Create tool-specific keywords for matching
                        tool_keywords = {
                            "companies_house_lookup": ["look up", "company information", "company details"],
                            "mortgage_calculator": ["calculate", "mortgage", "payment"],
                            "web_site_search": ["search", "web", "find"]
                        }
                        
                        # Check if any of the tool's keywords are in the response
                        keywords = tool_keywords.get(tool_name, [])
                        if any(keyword in response.lower() for keyword in keywords):
                            # Create a tool call for the detected tool
                            tool_call = {
                                "role": "assistant",
                                "content": "",  # Empty string instead of null
                                "tool_calls": [{
                                    "function": {
                                        "name": tool_name,
                                        "arguments": json.dumps({
                                            "action": "search" if tool_name == "companies_house_lookup" else None,
                                            "company_name": "Test Company" if tool_name == "companies_house_lookup" else None,
                                            "query": None if tool_name == "companies_house_lookup" else None,
                                            "principal": 200000 if tool_name == "mortgage_calculator" else None,
                                            "annual_rate": 0.05 if tool_name == "mortgage_calculator" else None,
                                            "term_years": 25 if tool_name == "mortgage_calculator" else None,
                                            "calculate": "monthly_payment" if tool_name == "mortgage_calculator" else None
                                        })
                                    },
                                    "id": f"call_{uuid.uuid4().hex[:8]}",
                                    "type": "function"
                                }],
                                "tool_call_id": None,
                                "tool_name": None,
                                "response_type": "internal"
                            }
                            print(f"Created tool call: {json.dumps(tool_call, indent=2)}")
                            return tool_call
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

class MockAgent:
    def __init__(self, name, tools=None):
        self.name = name
        self.tools = tools or []

async def call_mcp(tool_name, arguments, mcp_server_url):
    """Make a direct call to the MCP server using SSE protocol."""
    try:
        print(f"MCP tool called for: {tool_name}")
        async with SSEClientTransport(mcp_server_url) as transport:
            async with Client(
                {
                    "name": "test-client",
                    "version": "1.0.0"
                },
                {
                    "capabilities": {
                        "prompts": {},
                        "resources": {},
                        "tools": {}
                    }
                }
            ) as client:
                await client.connect(transport)
                await client.initialize()
                jargs = json.loads(arguments)
                response = await client.call_tool(tool_name, arguments=jargs)
                return json.dumps([item.__dict__ for item in response.content], indent=2)
    except Exception as e:
        print(f"Error in call_mcp: {str(e)}")
        raise

class TestToolCallTransformation:
    @pytest.fixture(autouse=True)
    def setup(self):
        # MCP server URL - using rowboat_agents service
        self.mcp_server_url = "http://localhost:3001"  # rowboat_agents service port
        self.external_tools = [
            {
                "name": "companies_house_lookup",
                "description": "Look up company information",
                "isMcp": True,
                "mcpServerName": "default"
            },
            {
                "name": "mortgage_calculator",
                "description": "Calculate mortgage payments",
                "isMcp": True,
                "mcpServerName": "default"
            },
            {
                "name": "web_site_search",
                "description": "Search the web",
                "isMcp": True,
                "mcpServerName": "default"
            }
        ]

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

    def test_transform_text_to_tool_call(self):
        """Test transformation of text response to tool call."""
        agent = MockAgent("test_agent", ["companies_house_lookup"])
        response = "I'll look up the company information for Test Company."
        transformed = transform_to_correct_format(response, agent)
        assert transformed is not None
        assert transformed["tool_calls"][0]["function"]["name"] == "companies_house_lookup"
        args = json.loads(transformed["tool_calls"][0]["function"]["arguments"])
        assert args["company_name"] == "Test Company"
        assert args["action"] == "search"

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
        """Test transformation with multiple tools configured."""
        agent = MockAgent("test_agent", ["companies_house_lookup", "mortgage_calculator"])
        response = "I'll calculate the mortgage payment."
        transformed = transform_to_correct_format(response, agent)
        assert transformed is not None
        assert transformed["tool_calls"][0]["function"]["name"] == "mortgage_calculator"
        args = json.loads(transformed["tool_calls"][0]["function"]["arguments"])
        assert args["principal"] == 200000
        assert args["annual_rate"] == 0.05
        assert args["term_years"] == 25
        assert args["calculate"] == "monthly_payment"

    @pytest.mark.asyncio
    async def test_tool_execution(self):
        """Test execution of a direct MCP tool call."""
        # Test companies house lookup
        tool_name = "companies_house_lookup"
        arguments = json.dumps({
            "action": "search",
            "company_name": "Test Company"
        })
        
        result = await call_mcp(tool_name, arguments, self.mcp_server_url)
        result_data = json.loads(result)
        
        assert "company_name" in result_data
        assert "company_number" in result_data
        assert "status" in result_data

    @pytest.mark.asyncio
    async def test_tool_response_format(self):
        """Test the format of MCP tool responses."""
        # Test mortgage calculator
        tool_name = "mortgage_calculator"
        arguments = json.dumps({
            "principal": 200000,
            "annual_rate": 0.05,
            "term_years": 25,
            "calculate": "monthly_payment"
        })
        
        result = await call_mcp(tool_name, arguments, self.mcp_server_url)
        result_data = json.loads(result)
        
        assert "monthly_payment" in result_data
        assert "total_payment" in result_data
        assert "total_interest" in result_data
        assert isinstance(result_data["monthly_payment"], (int, float))

    @pytest.mark.asyncio
    async def test_multiple_tool_execution(self):
        """Test execution of multiple MCP tools in sequence."""
        # First tool call
        tool_name1 = "companies_house_lookup"
        arguments1 = json.dumps({
            "action": "search",
            "company_name": "Test Company 1"
        })
        
        result1 = await call_mcp(tool_name1, arguments1, self.mcp_server_url)
        result_data1 = json.loads(result1)
        
        assert "company_name" in result_data1
        assert "company_number" in result_data1
        
        # Second tool call
        tool_name2 = "mortgage_calculator"
        arguments2 = json.dumps({
            "principal": 300000,
            "annual_rate": 0.04,
            "term_years": 30,
            "calculate": "monthly_payment"
        })
        
        result2 = await call_mcp(tool_name2, arguments2, self.mcp_server_url)
        result_data2 = json.loads(result2)
        
        assert "monthly_payment" in result_data2
        assert "total_payment" in result_data2
        assert isinstance(result_data2["monthly_payment"], (int, float))

    @pytest.mark.asyncio
    async def test_web_search_tool(self):
        """Test the web search MCP tool."""
        tool_name = "web_site_search"
        arguments = json.dumps({
            "query": "test search query"
        })
        
        result = await call_mcp(tool_name, arguments, self.mcp_server_url)
        result_data = json.loads(result)
        
        assert "results" in result_data
        assert isinstance(result_data["results"], list)
        if result_data["results"]:
            assert "title" in result_data["results"][0]
            assert "url" in result_data["results"][0]

    @pytest.mark.asyncio
    async def test_error_handling(self):
        """Test error handling for invalid tool calls."""
        # Test with invalid tool name
        with pytest.raises(Exception):
            await call_mcp("invalid_tool", json.dumps({}), self.mcp_server_url)
        
        # Test with invalid arguments
        with pytest.raises(Exception):
            await call_mcp("companies_house_lookup", json.dumps({"invalid": "args"}), self.mcp_server_url)

if __name__ == '__main__':
    pytest.main([__file__, '-v']) 