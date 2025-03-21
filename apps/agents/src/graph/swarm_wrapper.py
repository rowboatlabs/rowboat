import logging
import json

# Import helper functions needed for get_agents
from .helpers.access import (
    get_tool_config_by_name,
    get_tool_config_by_type
)
from .helpers.instructions import (
    add_rag_instructions_to_agent
)

from agents import Agent as NewAgent, Runner, FunctionTool, RunContextWrapper
# Add import for OpenAI functionality
from src.utils.common import common_logger as logger, generate_openai_output
from typing import Any
# Create a dedicated logger for swarm wrapper
#logger = logging.getLogger("swarm_wrapper")
#logger.setLevel(logging.INFO)

from pydantic import BaseModel
from typing import List, Optional, Dict

class NewResponse(BaseModel):
    messages: List[Dict]
    agent: Optional[Any] = None
    tokens_used: Optional[dict] = {}
    error_msg: Optional[str] = ""

async def catch_all(ctx: RunContextWrapper[Any], args: str, tool_name: str, tool_config: dict) -> str:
    print(f"Catch all called for tool: {tool_name}")
    print(f"Args: {args}")
    print(f"Tool config: {tool_config}")
    #if tool_config.get("mock", False):
    #&    return tool_config.get("mockInstructions", "No mock instructions provided")
    description = tool_config.get("description", "")

    messages = [
        {"role": "system", "content": f"You are simulating the execution of a tool called '{tool_name}'. The tool has this description: {description}. Generate a realistic response as if the tool was actually executed with the given parameters."},
        {"role": "user", "content": f"Generate a realistic response for the tool '{tool_name}' with these parameters: {args}. The response should be concise and focused on what the tool would actually return."}

    ]
    response_content = generate_openai_output(messages, output_type='text', model="gpt-4o")
    print(response_content)
    return(response_content)

def get_agents(agent_configs, tool_configs):
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
        for tool_name in agent_config["tools"]:
            tool_config = get_tool_config_by_name(tool_configs, tool_name)

            if tool_config:
                external_tools.append({
                    "type": "function",
                    "function": tool_config
                })
                #TODO: Remove this once we have a way to handle the additionalProperties
                tool_config['parameters']['additionalProperties'] = False
                tool = FunctionTool(
                    name=tool_name,
                    description=tool_config["description"],
                    params_json_schema=tool_config["parameters"],
                    on_invoke_tool=lambda ctx, args, _tool_name=tool_name, _tool_config=tool_config:
                        catch_all(ctx, args, _tool_name, _tool_config)
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
        try:
            new_agent = NewAgent(
                name=agent_config["name"],
                instructions=agent_config["instructions"],
                handoff_description=agent_config["description"],
                tools=new_tools,
                model=agent_config["model"]
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

    return new_agents


def create_response(messages=None, tokens_used=None, agent=None, error_msg=''):
    """
    Create a Response object with the given parameters.

    Args:
        messages: List of messages
        tokens_used: Dictionary tracking token usage
        agent: The agent that generated the response
        error_msg: Error message if any

    Returns:
        Response object
    """
    if messages is None:
        messages = []
    if tokens_used is None:
        tokens_used = {}

    return NewResponse(
        messages=messages,
        agent=agent,
        tokens_used=tokens_used,
        error_msg=error_msg
    )


def run(
    agent,
    messages,
    external_tools=None,
    tokens_used=None
):
    """
    Wrapper function for initializing and running the Swarm client.

    Args:
        agent: The agent to run
        messages: List of messages for the agent to process
        execute_tools: Whether to execute tools or just return tool calls
        external_tools: List of external tools available to the agent
        localize_history: Whether to localize history for the agent
        parent_has_child_history: Whether parent agents have access to child agent history
        max_messages_per_turn: Maximum number of messages to process in a turn
        tokens_used: Dictionary tracking token usage

    Returns:
        Response object from the Swarm client
    """
    logger.info(f"Initializing Swarm client for agent: {agent.name}")
    print(f"Initializing Swarm client for agent: {agent.name}")

    # Initialize default parameters
    if external_tools is None:
        external_tools = []
    if tokens_used is None:
        tokens_used = {}

    # Format messages to ensure they're compatible with the OpenAI API
    formatted_messages = []
    for msg in messages:
        # Check if the message has the expected format
        if isinstance(msg, dict) and "content" in msg:
            # Make sure the message has the required fields for OpenAI API
            formatted_msg = {
                "role": msg.get("role", "user"),
                "content": msg["content"]
            }
            formatted_messages.append(formatted_msg)
        else:
            # If the message is just a string, assume it's a user message
            formatted_messages.append({
                "role": "user",
                "content": str(msg)
            })

    # Run the agent with the formatted messages
    logger.info("Beginning Swarm run with run_sync")
    print("Beginning Swarm run with run_sync")
    response2 = Runner.run_sync(agent, formatted_messages)

    logger.info(f"Completed Swarm run for agent: {agent.name}")
    print(f"Completed Swarm run for agent: {agent.name}")
    return response2