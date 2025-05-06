import logging
import json
import aiohttp
import jwt
import hashlib
from agents import OpenAIChatCompletionsModel

# Import helper functions needed for get_agents
from .helpers.access import (
    get_tool_config_by_name,
    get_tool_config_by_type
)
from .helpers.instructions import (
    add_rag_instructions_to_agent
)

from agents import Agent as NewAgent, Runner, FunctionTool, RunContextWrapper, ModelSettings, WebSearchTool
# Add import for OpenAI functionality
from src.utils.common import common_logger as logger, generate_openai_output
from typing import Any
from dataclasses import asdict
import asyncio
from mcp import ClientSession
from mcp.client.sse import sse_client

from pydantic import BaseModel
from typing import List, Optional, Dict
from .tool_calling import call_rag_tool
from pymongo import MongoClient
import os
MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/rowboat").strip()
mongo_client = MongoClient(MONGO_URI)
db = mongo_client["rowboat"]

from src.utils.client import client, PROVIDER_DEFAULT_MODEL

class NewResponse(BaseModel):
    messages: List[Dict]
    agent: Optional[Any] = None
    tokens_used: Optional[dict] = {}
    error_msg: Optional[str] = ""

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
        logger.error(f"Error in mock_tool: {str(e)}")
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
        logger.error(f"Exception in call_webhook: {str(e)}")
        return f"Error: Failed to call webhook - {str(e)}"

async def call_mcp(tool_name: str, args: str, mcp_server_url: str) -> str:
    try:
        print(f"MCP tool called for: {tool_name}")
        async with sse_client(url=mcp_server_url) as streams:
            async with ClientSession(*streams) as session:
                await session.initialize()
                jargs = json.loads(args)
                response = await session.call_tool(tool_name, arguments=jargs)
                json_output = json.dumps([item.__dict__ for item in response.content], indent=2)

        return json_output
    except Exception as e:
        logger.error(f"Error in call_mcp: {str(e)}")
        return f"Error: {str(e)}"

async def catch_all(ctx: RunContextWrapper[Any], args: str, tool_name: str, tool_config: dict, complete_request: dict) -> str:
    try:
        print(f"Catch all called for tool: {tool_name}")
        print(f"Args: {args}")
        print(f"Tool config: {tool_config}")

        # Create event loop for async operations
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        response_content = None
        if tool_config.get("mockTool", False) or complete_request.get("testProfile", {}).get("mockTools", False):
            # Call mock_tool to handle the response (it will decide whether to use mock instructions or generate a response)
            if complete_request.get("testProfile", {}).get("mockPrompt", ""):
                response_content = await mock_tool(tool_name, args, tool_config.get("description", ""), complete_request.get("testProfile", {}).get("mockPrompt", ""))
            else:
                response_content = await mock_tool(tool_name, args, tool_config.get("description", ""), tool_config.get("mockInstructions", ""))
            print(response_content)
        elif tool_config.get("isMcp", False):
            mcp_server_name = tool_config.get("mcpServerName", "")
            mcp_servers = complete_request.get("mcpServers", {})
            mcp_server_url = next((server.get("url", "") for server in mcp_servers if server.get("name") == mcp_server_name), "")
            response_content = await call_mcp(tool_name, args, mcp_server_url)
        else:
            collection = db["projects"]
            doc = collection.find_one({"_id": complete_request.get("projectId", "")})
            signing_secret = doc.get("secret", "")
            webhook_url = complete_request.get("toolWebhookUrl", "")
            response_content = await call_webhook(tool_name, args, webhook_url, signing_secret)
        return response_content
    except Exception as e:
        logger.error(f"Error in catch_all: {str(e)}")
        return f"Error: {str(e)}"


def get_rag_tool(config: dict, complete_request: dict) -> FunctionTool:
    """
    Creates a RAG tool based on the provided configuration.
    """
    project_id = complete_request.get("projectId", "")
    if config.get("ragDataSources", None):
        print("getArticleInfo")
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
            name="getArticleInfo",
            description="Get information about an article",
            params_json_schema=params,
            on_invoke_tool=lambda ctx, args: call_rag_tool(project_id, json.loads(args)['query'], config.get("ragDataSources", []), "chunks", 3)
        )
        return tool
    else:
        return None

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
    # Create Agent objects from config
    for agent_config in agent_configs:
        logger.debug(f"Processing config for agent: {agent_config['name']}")
        print("="*100)
        print(f"Processing config for agent: {agent_config['name']}")

        # If hasRagSources, append the RAG tool to the agent's tools
        if agent_config.get("hasRagSources", False):
            rag_tool_name = get_tool_config_by_type(tool_configs, "rag").get("name", "")
            agent_config["tools"].append(rag_tool_name)
            agent_config = add_rag_instructions_to_agent(agent_config, rag_tool_name)

        # Prepare tool lists for this agent
        external_tools = []

        logger.debug(f"Agent {agent_config['name']} has {len(agent_config['tools'])} configured tools")
        print(f"Agent {agent_config['name']} has {len(agent_config['tools'])} configured tools")

        new_tools = []
        rag_tool = get_rag_tool(agent_config, complete_request)
        if rag_tool:
            new_tools.append(rag_tool)
            logger.debug(f"Added rag tool to agent {agent_config['name']}")
            print(f"Added rag tool to agent {agent_config['name']}")
            agent_config = add_rag_instructions_to_agent(agent_config, rag_tool.name)

        for tool_name in agent_config["tools"]:

            tool_config = get_tool_config_by_name(tool_configs, tool_name)

            if tool_config:
                external_tools.append({
                    "type": "function",
                    "function": tool_config
                })
                if tool_name == "web_search":
                    tool = WebSearchTool()
                else:
                    tool = FunctionTool(
                        name=tool_name,
                        description=tool_config["description"],
                        params_json_schema=tool_config["parameters"],
                        strict_json_schema=False,
                    on_invoke_tool=lambda ctx, args, _tool_name=tool_name, _tool_config=tool_config, _complete_request=complete_request:
                        catch_all(ctx, args, _tool_name, _tool_config, _complete_request)
                    )
                new_tools.append(tool)
                logger.debug(f"Added tool {tool_name} to agent {agent_config['name']}")
                print(f"Added tool {tool_name} to agent {agent_config['name']}")
            else:
                logger.warning(f"Tool {tool_name} not found in tool_configs")
                print(f"WARNING: Tool {tool_name} not found in tool_configs")

        # Create the agent object
        logger.debug(f"Creating Agent object for {agent_config['name']}")
        print(f"Creating Agent object for {agent_config['name']}")

        # add the name and description to the agent instructions
        agent_instructions = f"## Your Name\n{agent_config['name']}\n\n## Description\n{agent_config['description']}\n\n## Instructions\n{agent_config['instructions']}"
        try:
            model_name = agent_config["model"] if agent_config["model"] else PROVIDER_DEFAULT_MODEL
            print(f"Using model: {model_name}")
            model=OpenAIChatCompletionsModel(model=model_name, openai_client=client) if client else agent_config["model"]
            new_agent = NewAgent(
                name=agent_config["name"],
                instructions=agent_instructions,
                handoff_description=agent_config["description"],
                tools=new_tools,
                model = model,
                model_settings=ModelSettings(temperature=0.0)
            )

            new_agent_to_children[agent_config["name"]] = agent_config.get("connectedAgents", [])
            new_agent_name_to_index[agent_config["name"]] = len(new_agents)
            new_agents.append(new_agent)
            logger.debug(f"Successfully created agent: {agent_config['name']}")
            print(f"Successfully created agent: {agent_config['name']}")
        except Exception as e:
            logger.error(f"Failed to create agent {agent_config['name']}: {str(e)}")
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

async def run_streamed(
    agent,
    messages,
    external_tools=None,
    tokens_used=None
):
    """
    Wrapper function for initializing and running the Swarm client in streaming mode.
    """
    logger.info(f"Initializing Swarm streaming client for agent: {agent.name}")
    print(f"Initializing Swarm streaming client for agent: {agent.name}")

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
            formatted_messages.append(formatted_msg)
        else:
            formatted_messages.append({
                "role": "user",
                "content": str(msg)
            })

    logger.info("Beginning Swarm streaming run")
    print("Beginning Swarm streaming run")

    try:
        # Use the Runner.run_streamed method
        stream_result = Runner.run_streamed(agent, formatted_messages)
        return stream_result
    except Exception as e:
        logger.error(f"Error during streaming run: {str(e)}")
        print(f"Error during streaming run: {str(e)}")
        raise