import logging
import json
import aiohttp
import jwt
import hashlib
from agents import OpenAIChatCompletionsModel, trace, add_trace_processor

# Import helper functions needed for get_agents
from .helpers.access import (
    get_tool_config_by_name,
    get_tool_config_by_type
)
from .helpers.instructions import (
    add_rag_instructions_to_agent
)
from .types import outputVisibility
from agents import Agent as NewAgent, Runner, FunctionTool, RunContextWrapper, ModelSettings, WebSearchTool
from .tracing import AgentTurnTraceProcessor
# Add import for OpenAI functionality
from src.utils.common import generate_openai_output
from typing import Any
import asyncio
from mcp import ClientSession  # Change back to original import
from mcp.client.sse import sse_client

from pydantic import BaseModel
from typing import List, Optional, Dict
from .tool_calling import call_rag_tool
from pymongo import MongoClient
import os
MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/rowboat").strip()
mongo_client = MongoClient(MONGO_URI)
db = mongo_client["rowboat"]

from src.utils.client import client as openai_client, PROVIDER_DEFAULT_MODEL

class NewResponse(BaseModel):
    messages: List[Dict]
    agent: Optional[Any] = None
    tokens_used: Optional[dict] = {}
    error_msg: Optional[str] = ""

# Add at the top of the file after imports
_request_cache = {}
_tool_call_in_progress = set()
_tool_execution_locks = {}  # Dictionary to store locks per tool call

async def get_tool_lock(call_key: str) -> asyncio.Lock:
    """Get or create a lock for a specific tool call."""
    if call_key not in _tool_execution_locks:
        _tool_execution_locks[call_key] = asyncio.Lock()
    return _tool_execution_locks[call_key]

async def mock_tool(tool_name: str, args: str, description: str, mock_instructions: str) -> str:
    try:
        print(f"Mock tool called for: {tool_name}")

        messages = [
            {"role": "system", "content": f"You are simulating the execution of a tool called '{tool_name}'.Here is the description of the tool: {description}. Here are the instructions for the mock tool: {mock_instructions}. Generate a realistic response as if the tool was actually executed with the given parameters."},
            {"role": "user", "content": f"Generate a realistic response for the tool '{tool_name}' with these parameters: {args}. The response should be concise and focused on what the tool would actually return."}
        ]

        print(f"Generating simulated response for tool: {tool_name}")
        response_content = None
        response_content = generate_openai_output(messages, output_type='text', model=PROVIDER_DEFAULT_MODEL)
        return response_content
    except Exception as e:
        print(f"Error in mock_tool: {str(e)}")
        return f"Error: {str(e)}"

async def call_webhook(tool_name: str, args: str, webhook_url: str, signing_secret: str) -> str:
    try:
        print(f"Calling webhook for tool: {tool_name}")
        content_dict = {
            "toolCall": {
                "function": {
                    "name": tool_name,
                    "arguments": args
                }
            }
        }
        request_body = {
            "content": json.dumps(content_dict)
        }

        # Prepare headers
        headers = {}
        if signing_secret:
            content_str = request_body["content"]
            body_hash = hashlib.sha256(content_str.encode('utf-8')).hexdigest()
            payload = {"bodyHash": body_hash}
            signature_jwt = jwt.encode(payload, signing_secret, algorithm="HS256")
            headers["X-Signature-Jwt"] = signature_jwt

        async with aiohttp.ClientSession() as session:
            async with session.post(webhook_url, json=request_body, headers=headers) as response:
                if response.status == 200:
                    response_json = await response.json()
                    return response_json.get("result", "")
                else:
                    error_msg = await response.text()
                    print(f"Webhook error: {error_msg}")
                    return f"Error: {error_msg}"
    except Exception as e:
        print(f"Exception in call_webhook: {str(e)}")
        return f"Error: Failed to call webhook - {str(e)}"

async def call_mcp(tool_name: str, args: str, mcp_server_url: str) -> str:
    try:
        print(f"🔄 MCP tool called for: {tool_name}")
        mcp_server_url = mcp_server_url.strip()
        print(f"🌐 MCP server URL: {mcp_server_url}")
        
        # Parse and clean arguments
        try:
            jargs = json.loads(args)
            # Remove any mcp_servers from args if present
            if 'mcp_servers' in jargs:
                del jargs['mcp_servers']
            
            # Normalize all string arguments to lowercase
            normalized_args = {}
            for key, value in jargs.items():
                if isinstance(value, str):
                    normalized_args[key] = value.lower().strip()
                else:
                    normalized_args[key] = value
            
            print(f"📤 Making MCP call with normalized args: {normalized_args}")
        except json.JSONDecodeError as e:
            print(f"❌ Error parsing arguments: {str(e)}")
            raise ValueError(f"Invalid JSON arguments: {str(e)}")
        
        # Create a unique key for this MCP call
        call_key = f"{tool_name}:{json.dumps(normalized_args, sort_keys=True)}"
        print(f"🔑 MCP call key: {call_key}")
        
        # Get the lock for this specific tool call
        lock = await get_tool_lock(call_key)
        
        # Use the lock to prevent concurrent execution
        async with lock:
            # Check if we've already made this request
            if call_key in _request_cache:
                print(f"💾 Returning cached MCP response for {call_key}")
                return _request_cache[call_key]
            
            # Check if this call is already in progress
            if call_key in _tool_call_in_progress:
                print(f"⚠️ MCP call {call_key} already in progress")
                cached_response = _request_cache.get(call_key)
                if cached_response:
                    return cached_response
                return json.dumps({
                    "role": "tool",
                    "name": tool_name,
                    "content": [{"type": "text", "text": "MCP call in progress...", "annotations": None}]
                })
            
            # Mark this call as in progress
            _tool_call_in_progress.add(call_key)
            print(f"🔒 Locked MCP call: {call_key}")
            
            try:
                # Create SSE client with a single connection
                try:
                    async with sse_client(url=mcp_server_url, timeout=60) as streams:
                        print(f"📡 SSE streams received: {streams} (type: {type(streams)})")
                        
                        if not streams:
                            raise ValueError("No SSE streams received")
                        
                        # Ensure we have exactly two streams
                        if not isinstance(streams, (list, tuple)):
                            raise ValueError(f"Expected streams to be a list or tuple, got {type(streams)}")
                        
                        if len(streams) != 2:
                            raise ValueError(f"Expected exactly 2 SSE streams, got {len(streams)}")
                        
                        stream0, stream1 = streams[0], streams[1]
                        print(f"📡 Successfully unpacked streams: {type(stream0)}, {type(stream1)}")
                        
                        # Create session and make the tool call
                        async with ClientSession(stream0, stream1) as session:
                            await session.initialize()
                            print(f"📡 Making tool call to {tool_name} with normalized args")
                            response = await session.call_tool(tool_name, arguments=normalized_args)
                            
                            if not response:
                                raise ValueError("No response received from MCP server")
                            
                            # Handle the response content
                            if hasattr(response, 'content'):
                                content = response.content
                                if isinstance(content, list):
                                    # Convert list items to text
                                    content_list = []
                                    for item in content:
                                        if hasattr(item, 'text'):
                                            content_list.append(item.text)
                                        else:
                                            content_list.append(str(item))
                                    result = json.dumps({
                                        "role": "tool",
                                        "name": tool_name,
                                        "content": [{"type": "text", "text": "\n".join(content_list), "annotations": None}]
                                    })
                                else:
                                    # Handle single item response
                                    text = content.text if hasattr(content, 'text') else str(content)
                                    result = json.dumps({
                                        "role": "tool",
                                        "name": tool_name,
                                        "content": [{"type": "text", "text": text, "annotations": None}]
                                    })
                                print(f"📥 MCP response processed successfully")
                                
                                # Cache the response
                                _request_cache[call_key] = result
                                print(f"💾 Cached MCP response for {call_key}")
                                
                                return result
                            else:
                                raise ValueError("Response has no content attribute")
                except Exception as e:
                    print(f"❌ Error in SSE client: {str(e)}")
                    raise
            finally:
                # Remove the in-progress flag
                _tool_call_in_progress.remove(call_key)
                print(f"🔓 Unlocked MCP call: {call_key}")
                    
    except Exception as e:
        print(f"❌ Error in call_mcp: {str(e)}")
        return json.dumps({
            "role": "tool",
            "name": tool_name,
            "content": [{"type": "text", "text": f"Error: {str(e)}", "annotations": None}]
        })

async def catch_all(ctx: RunContextWrapper[Any], args: str, tool_name: str, tool_config: dict, complete_request: dict) -> str:
    try:
        print("\n" + "="*50)
        print(f"TOOL CALL STARTED:")
        print(f"Tool: {tool_name}")
        print(f"Arguments: {args}")
        print(f"Tool Config: {json.dumps(tool_config, indent=2)}")
        print("="*50 + "\n")

        # Normalize arguments for consistent caching
        try:
            args_dict = json.loads(args)
            # Convert all string values to lowercase for case-insensitive comparison
            normalized_args = {k: v.lower() if isinstance(v, str) else v for k, v in args_dict.items()}
            normalized_args_str = json.dumps(normalized_args, sort_keys=True)
        except json.JSONDecodeError:
            normalized_args_str = args

        # Create a unique key for this tool call using normalized arguments
        call_key = f"{tool_name}:{normalized_args_str}"
        print(f"🔑 Normalized cache key: {call_key}")
        
        # Get the lock for this specific tool call
        lock = await get_tool_lock(call_key)
        
        # Use the lock to prevent concurrent execution
        async with lock:
            # Check if this tool call is already in progress
            if call_key in _tool_call_in_progress:
                print(f"⚠️ Tool call {call_key} already in progress, returning cached response")
                cached_response = _request_cache.get(call_key)
                if cached_response:
                    print(f"💾 Found cached response for {call_key}")
                    return cached_response
                print(f"⚠️ No cached response found for {call_key}, returning in-progress message")
                return json.dumps({
                    "role": "tool",
                    "name": tool_name,
                    "content": [{"type": "text", "text": "Tool call in progress...", "annotations": None}]
                })
            
            # Check if we already have a cached response
            if call_key in _request_cache:
                print(f"💾 Returning cached response for {call_key}")
                return _request_cache[call_key]
            
            # Mark this tool call as in progress
            _tool_call_in_progress.add(call_key)
            print(f"🔒 Locked tool call: {call_key}")
            
            try:
                # Create event loop for async operations
                try:
                    loop = asyncio.get_event_loop()
                except RuntimeError:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)

                if tool_config.get("mockTool", False) or complete_request.get("testProfile", {}).get("mockTools", False):
                    print(f"🤖 Using mock tool for: {tool_name}")
                    # Call mock_tool to handle the response
                    if complete_request.get("testProfile", {}).get("mockPrompt", ""):
                        response_content = await mock_tool(tool_name, args, tool_config.get("description", ""), complete_request.get("testProfile", {}).get("mockPrompt", ""))
                    else:
                        response_content = await mock_tool(tool_name, args, tool_config.get("description", ""), tool_config.get("mockInstructions", ""))
                    print(f"📝 Mock tool response: {response_content}")
                    response = json.dumps({
                        "role": "tool",
                        "name": tool_name,
                        "content": [{"type": "text", "text": response_content, "annotations": None}]
                    })
                elif tool_config.get("isMcp", False):
                    print(f"🔄 Using MCP tool: {tool_name}")
                    mcp_server_name = tool_config.get("mcpServerName", "")
                    mcp_servers = complete_request.get("mcpServers", {})
                    mcp_server_url = next((server.get("url", "") for server in mcp_servers if server.get("name") == mcp_server_name), "")
                    print(f"🌐 MCP Server URL: {mcp_server_url}")
                    
                    # Make the MCP call and cache the response
                    try:
                        print(f"📡 Making MCP call to {tool_name}")
                        response = await call_mcp(tool_name, normalized_args_str, mcp_server_url)
                        print(f"📥 MCP response received: {response[:200]}...")  # Print first 200 chars
                    except Exception as e:
                        print(f"❌ Error in MCP call: {str(e)}")
                        response = json.dumps({
                            "role": "tool",
                            "name": tool_name,
                            "content": [{"type": "text", "text": f"Error: {str(e)}", "annotations": None}]
                        })
                else:
                    print(f"🌐 Using webhook for tool: {tool_name}")
                    collection = db["projects"]
                    doc = collection.find_one({"_id": complete_request.get("projectId", "")})
                    signing_secret = doc.get("secret", "")
                    webhook_url = complete_request.get("toolWebhookUrl", "")
                    print(f"🔗 Webhook URL: {webhook_url}")
                    response_content = await call_webhook(tool_name, args, webhook_url, signing_secret)
                    print(f"📥 Webhook response: {response_content[:200]}...")  # Print first 200 chars
                    response = json.dumps({
                        "role": "tool",
                        "name": tool_name,
                        "content": [{"type": "text", "text": response_content, "annotations": None}]
                    })
                
                # Cache the response
                _request_cache[call_key] = response
                print(f"💾 Cached response for {tool_name}")
                print("\n" + "="*50)
                print(f"TOOL CALL COMPLETED: {tool_name}")
                print("="*50 + "\n")
                return response
                
            finally:
                # Remove the in-progress flag
                _tool_call_in_progress.remove(call_key)
                print(f"🔓 Unlocked tool call: {call_key}")
                
    except Exception as e:
        print(f"❌ Error in catch_all: {str(e)}")
        return json.dumps({
            "role": "tool",
            "name": tool_name,
            "content": [{"type": "text", "text": f"Error: {str(e)}", "annotations": None}]
        })


def get_rag_tool(config: dict, complete_request: dict) -> FunctionTool:
    """
    Creates a RAG tool based on the provided configuration.
    """
    project_id = complete_request.get("projectId", "")
    if config.get("ragDataSources", None):
        print(f"Creating rag_search tool with params:\n-Data Sources: {config.get('ragDataSources', [])}\n-Return Type: {config.get('ragReturnType', 'chunks')}\n-K: {config.get('ragK', 3)}")
        params = {
            "type": "object",
            "properties": {
                "query": {
                "type": "string",
                "description": "The query to search for"
                }
            },
            "additionalProperties": False,
            "required": [
                "query"
            ]
        }
        tool = FunctionTool(
                name="rag_search",
                description="Get information about an article",
                params_json_schema=params,
                on_invoke_tool=lambda ctx, args: call_rag_tool(project_id, json.loads(args)['query'], config.get("ragDataSources", []), config.get("ragReturnType", "chunks"), config.get("ragK", 3))
        )
        return tool
    else:
        return None
    
DEFAULT_MAX_CALLS_PER_PARENT_AGENT = 3

def get_agents(agent_configs, tool_configs, complete_request):
    """
    Creates and initializes Agent objects based on their configurations and connections.
    """
    if not isinstance(agent_configs, list):
        raise ValueError("Agents config is not a list in get_agents")
    if not isinstance(tool_configs, list):
        raise ValueError("Tools config is not a list in get_agents")

    new_agents = []
    new_agent_to_children = {}
    new_agent_name_to_index = {}
    
    # Create a dictionary to store tool handlers
    tool_handlers = {}
    
    # Create Agent objects from config
    for agent_config in agent_configs:
        print("="*100)
        print(f"Processing config for agent: {agent_config['name']}")

        # If hasRagSources, append the RAG tool to the agent's tools
        if agent_config.get("hasRagSources", False):
            rag_tool_name = get_tool_config_by_type(tool_configs, "rag").get("name", "")
            agent_config["tools"].append(rag_tool_name)
            agent_config = add_rag_instructions_to_agent(agent_config, rag_tool_name)

        # Prepare tool lists for this agent
        external_tools = []

        print(f"Agent {agent_config['name']} has {len(agent_config['tools'])} configured tools")

        new_tools = []

        for tool_name in agent_config["tools"]:
            tool_config = get_tool_config_by_name(tool_configs, tool_name)

            if tool_config:
                external_tools.append({
                    "type": "function",
                    "function": tool_config
                })
                if tool_name == "web_search":
                    tool = WebSearchTool()
                elif tool_name == "rag_search":
                    tool = get_rag_tool(agent_config, complete_request)
                else:
                    # Create or reuse tool handler
                    if tool_name not in tool_handlers:
                        def create_tool_handler(_tool_name, _tool_config, _complete_request):
                            async def handler(ctx, args):
                                try:
                                    # Parse and normalize arguments
                                    try:
                                        args_dict = json.loads(args)
                                        normalized_args = {k: v.lower() if isinstance(v, str) else v for k, v in args_dict.items()}
                                        normalized_args_str = json.dumps(normalized_args, sort_keys=True)
                                    except json.JSONDecodeError:
                                        normalized_args_str = args

                                    # Create a unique key for this tool call
                                    call_key = f"{_tool_name}:{normalized_args_str}"
                                    print(f"🔑 Tool handler cache key: {call_key}")
                                    
                                    # Check if we've already made this request
                                    if call_key in _request_cache:
                                        print(f"💾 Tool handler returning cached response for {call_key}")
                                        return _request_cache[call_key]
                                    
                                    # Check if this tool call is already in progress
                                    if call_key in _tool_call_in_progress:
                                        print(f"⚠️ Tool handler found in-progress call for {call_key}")
                                        cached_response = _request_cache.get(call_key)
                                        if cached_response:
                                            return cached_response
                                        return json.dumps({
                                            "role": "tool",
                                            "name": _tool_name,
                                            "content": [{"type": "text", "text": "Tool call in progress...", "annotations": None}]
                                        })
                                    
                                    # Mark this tool call as in progress
                                    _tool_call_in_progress.add(call_key)
                                    print(f"🔒 Tool handler locked call: {call_key}")
                                    
                                    try:
                                        # Make the call and cache the response
                                        response = await catch_all(ctx, normalized_args_str, _tool_name, _tool_config, _complete_request)
                                        _request_cache[call_key] = response
                                        return response
                                    finally:
                                        # Remove the in-progress flag
                                        _tool_call_in_progress.remove(call_key)
                                        print(f"🔓 Tool handler unlocked call: {call_key}")
                                except Exception as e:
                                    print(f"❌ Error in tool handler: {str(e)}")
                                    return json.dumps({
                                        "role": "tool",
                                        "name": _tool_name,
                                        "content": [{"type": "text", "text": f"Error: {str(e)}", "annotations": None}]
                                    })
                            return handler
                        
                        tool_handlers[tool_name] = create_tool_handler(tool_name, tool_config, complete_request)
                    
                    tool = FunctionTool(
                        name=tool_name,
                        description=tool_config["description"],
                        params_json_schema=tool_config["parameters"],
                        strict_json_schema=False,
                        on_invoke_tool=tool_handlers[tool_name]
                    )
                if tool:
                    new_tools.append(tool)
                    print(f"Added tool {tool_name} to agent {agent_config['name']}")
            else:
                print(f"WARNING: Tool {tool_name} not found in tool_configs")

        # Create the agent object
        print(f"Creating Agent object for {agent_config['name']}")

        # add the name and description to the agent instructions
        agent_instructions = f"## Your Name\n{agent_config['name']}\n\n## Description\n{agent_config['description']}\n\n## Instructions\n{agent_config['instructions']}"
        
        # Add tool-specific instructions dynamically
        tool_instructions = []
        for tool in new_tools:
            tool_config = get_tool_config_by_name(tool_configs, tool.name)
            if tool_config:
                # Generate tool-specific instructions based on the tool's configuration
                tool_instructions.append(f"""
## {tool.name.title()} Instructions
- ALWAYS use the {tool.name} tool for any {tool_config['description'].lower()}
- NEVER provide information or perform operations manually that should be done by the {tool.name} tool
- NEVER make assumptions or provide information from your training data about topics that should be handled by the {tool.name} tool
- When using the {tool.name} tool, provide the required parameters as specified in the tool's configuration
- If you don't have all required parameters, ask the user for them before using the tool
- If the tool returns an error or no results, inform the user and ask for clarification or alternative information
""")

        if tool_instructions:
            agent_instructions += "\n\n" + "\n\n".join(tool_instructions)

        try:
            # Identify the model
            model_name = agent_config["model"] if agent_config["model"] else PROVIDER_DEFAULT_MODEL
            print(f"Using model: {model_name}")
            model=OpenAIChatCompletionsModel(model=model_name, openai_client=openai_client) if openai_client else agent_config["model"]

            # Create the agent object
            new_agent = NewAgent(
                name=agent_config["name"],
                instructions=agent_instructions,
                handoff_description=agent_config["description"],
                tools=new_tools,
                model=model,
                model_settings=ModelSettings(
                    temperature=0.0
                )
            )

            # Set the max calls per parent agent
            new_agent.max_calls_per_parent_agent = agent_config.get("maxCallsPerParentAgent", DEFAULT_MAX_CALLS_PER_PARENT_AGENT)
            if not agent_config.get("maxCallsPerParentAgent", None):
                print(f"WARNING: Max calls per parent agent not received for agent {new_agent.name}. Using rowboat_agents default of {DEFAULT_MAX_CALLS_PER_PARENT_AGENT}")
            else:
                print(f"Max calls per parent agent for agent {new_agent.name}: {new_agent.max_calls_per_parent_agent}")

            # Set output visibility
            new_agent.output_visibility = agent_config.get("outputVisibility", outputVisibility.EXTERNAL.value)
            if not agent_config.get("outputVisibility", None):
                print(f"WARNING: Output visibility not received for agent {new_agent.name}. Using rowboat_agents default of {new_agent.output_visibility}")
            else:
                print(f"Output visibility for agent {new_agent.name}: {new_agent.output_visibility}")

            # Handle the connected agents
            new_agent_to_children[agent_config["name"]] = agent_config.get("connectedAgents", [])
            new_agent_name_to_index[agent_config["name"]] = len(new_agents)
            new_agents.append(new_agent)
            print(f"Successfully created agent: {agent_config['name']}")
        except Exception as e:
            print(f"ERROR: Failed to create agent {agent_config['name']}: {str(e)}")
            raise

    for new_agent in new_agents:
        # Initialize the handoffs attribute if it doesn't exist
        if not hasattr(new_agent, 'handoffs'):
            new_agent.handoffs = []
        # Look up the agent's children from the old agent and create a list called handoffs in new_agent with pointers to the children in new_agents
        new_agent.handoffs = [new_agents[new_agent_name_to_index[child]] for child in new_agent_to_children[new_agent.name]]
    
    print("Returning created agents")
    print("="*100)
    return new_agents

# Initialize a flag to track if the trace processor is added
trace_processor_added = False

async def run_streamed(
    agent,
    messages,
    external_tools=None,
    tokens_used=None,
    enable_tracing=False
):
    """
    Wrapper function for initializing and running the Swarm client in streaming mode.
    """
    print(f"Initializing streaming client for agent: {agent.name}")

    # Initialize default parameters
    if external_tools is None:
        external_tools = []
    if tokens_used is None:
        tokens_used = {}

    # Format messages to ensure they're compatible with the OpenAI API
    formatted_messages = []
    for msg in messages:
        if isinstance(msg, dict) and "content" in msg:
            formatted_msg = {
                "role": msg.get("role", "user"),
                "content": msg["content"]
            }
            # Convert function role to tool role for tool responses
            if formatted_msg["role"] == "function":
                formatted_msg["role"] = "tool"
            formatted_messages.append(formatted_msg)
        else:
            formatted_messages.append({
                "role": "user",
                "content": str(msg)
            })

    print("Beginning streaming run")

    try:
        # Add our custom trace processor only if tracing is enabled
        global trace_processor_added
        if enable_tracing and not trace_processor_added:
            trace_processor = AgentTurnTraceProcessor()
            add_trace_processor(trace_processor)
            trace_processor_added = True

        # Get the stream result without trace context first
        stream_result = Runner.run_streamed(agent, formatted_messages)
        
        # Create a set to track processed tool calls
        processed_tool_calls = set()
        
        # Wrap the stream_events to handle tool role conversion and prevent duplicates
        original_stream_events = stream_result.stream_events
        
        async def wrapped_stream_events():
            try:
                async for event in original_stream_events():
                    # Handle tool calls
                    if isinstance(event, dict) and event.get("tool_calls"):
                        # Create a list to store unique tool calls
                        unique_tool_calls = []
                        
                        for tool_call in event["tool_calls"]:
                            try:
                                # Parse and normalize the arguments
                                args = json.loads(tool_call['function']['arguments'])
                                normalized_args = {}
                                for key, value in args.items():
                                    if isinstance(value, str):
                                        normalized_args[key] = value.lower().strip()
                                    else:
                                        normalized_args[key] = value
                                
                                # Create a unique key for this tool call
                                tool_call_key = f"{tool_call['function']['name']}:{json.dumps(normalized_args, sort_keys=True)}"
                                
                                # Skip if we've already processed this tool call
                                if tool_call_key in processed_tool_calls:
                                    print(f"🔄 Skipping duplicate tool call in stream: {tool_call_key}")
                                    continue
                                
                                # Mark this tool call as processed
                                processed_tool_calls.add(tool_call_key)
                                
                                # Update the tool call with normalized arguments
                                tool_call['function']['arguments'] = json.dumps(normalized_args)
                                unique_tool_calls.append(tool_call)
                                print(f"✅ Added unique tool call to stream: {tool_call_key}")
                            except json.JSONDecodeError as e:
                                print(f"❌ Error parsing tool call arguments in stream: {str(e)}")
                                continue
                        
                        # Only yield the event if we have unique tool calls
                        if unique_tool_calls:
                            event["tool_calls"] = unique_tool_calls
                            yield event
                        else:
                            print("⏭️ Skipping event with no unique tool calls")
                            continue
                    else:
                        # Convert function role to tool role for tool responses
                        if isinstance(event, dict) and event.get("role") == "function":
                            event["role"] = "tool"
                        yield event
            except GeneratorExit:
                # Handle generator exit gracefully
                raise
            except Exception as e:
                print(f"❌ Error in stream events: {str(e)}")
                # Return a formatted error response
                yield {
                    "role": "assistant",
                    "content": f"Error processing stream: {str(e)}",
                    "error": True
                }
                raise
        
        # Create a new stream result with our wrapped events
        class WrappedStreamResult:
            def __init__(self, original_result, wrapped_events):
                self.original_result = original_result
                self.stream_events = wrapped_events
                # Copy any other attributes from the original result
                for attr in dir(original_result):
                    if not attr.startswith('_') and not hasattr(self, attr):
                        setattr(self, attr, getattr(original_result, attr))
        
        wrapped_result = WrappedStreamResult(stream_result, wrapped_stream_events)
        return wrapped_result
    except Exception as e:
        print(f"❌ Error during streaming run: {str(e)}")
        raise