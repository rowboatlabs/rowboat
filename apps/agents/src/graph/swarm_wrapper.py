from src.swarm.core import Swarm
from src.swarm.types import Agent as SwarmAgent, Response as SwarmResponse
import logging

# Import helper functions needed for get_agents
from .helpers.access import (
    get_agent_data_by_name, get_agent_by_name, get_tool_config_by_name,
    get_tool_config_by_type
)
from .helpers.transfer import create_transfer_function_to_agent, create_transfer_function_to_parent_agent
from .helpers.instructions import (
    add_transfer_instructions_to_child_agents, add_transfer_instructions_to_parent_agents,
    add_rag_instructions_to_agent, add_universal_system_message_to_agent
)

# Create a dedicated logger for swarm wrapper
logger = logging.getLogger("swarm_wrapper")
logger.setLevel(logging.INFO)

# Re-export the types from src.swarm.types
Agent = SwarmAgent
Response = SwarmResponse


def get_agents(agent_configs, tool_configs, localize_history, available_tool_mappings,
               agent_data, start_turn_with_start_agent, children_aware_of_parent, universal_sys_msg):
    """
    Creates and initializes Agent objects based on their configurations and connections.
    This function also sets up parent-child relationships, transfer instructions, and
    universal system messages.
    """
    if not isinstance(agent_configs, list):
        raise ValueError("Agents config is not a list in get_agents")
    if not isinstance(tool_configs, list):
        raise ValueError("Tools config is not a list in get_agents")

    agents = []

    # Create Agent objects from config
    for agent_config in agent_configs:
        logger.debug(f"Processing config for agent: {agent_config['name']}")

        # If hasRagSources, append the RAG tool to the agent's tools
        if agent_config.get("hasRagSources", False):
            rag_tool_name = get_tool_config_by_type(tool_configs, "rag").get("name", "")
            agent_config["tools"].append(rag_tool_name)
            agent_config = add_rag_instructions_to_agent(agent_config, rag_tool_name)

        # Prepare tool lists for this agent
        external_tools = []
        internal_tools = []
        candidate_parent_functions = {}
        child_functions = {}

        logger.debug(f"Agent {agent_config['name']} has {len(agent_config['tools'])} configured tools")

        for tool_name in agent_config["tools"]:
            tool_config = get_tool_config_by_name(tool_configs, tool_name)
            if tool_config:
                if tool_name in available_tool_mappings:
                    internal_tools.append(available_tool_mappings[tool_name])
                else:
                    external_tools.append({
                        "type": "function",
                        "function": tool_config
                    })
                logger.debug(f"Added tool {tool_name} to agent {agent_config['name']}")
            else:
                logger.warning(f"Tool {tool_name} not found in tool_configs")

        # Localize history (if applicable)
        history = []
        this_agent_data = get_agent_data_by_name(agent_config["name"], agent_data)
        if this_agent_data and localize_history:
            history = this_agent_data.get("history", [])

        # Create the agent object
        logger.debug(f"Creating Agent object for {agent_config['name']}")
        try:
            agent = Agent(
                name=agent_config["name"],
                type=agent_config.get("type", "default"),
                instructions=agent_config["instructions"],
                description=agent_config.get("description", ""),
                internal_tools=internal_tools,
                external_tools=external_tools,
                candidate_parent_functions=candidate_parent_functions,
                child_functions=child_functions,
                model=agent_config["model"],
                respond_to_user=agent_config.get("respond_to_user", False),
                history=history,
                children_names=agent_config.get("connectedAgents", []),
                most_recent_parent=None
            )
            agents.append(agent)
            logger.debug(f"Successfully created agent: {agent_config['name']}")
        except Exception as e:
            logger.error(f"Failed to create agent {agent_config['name']}: {str(e)}")
            raise

    # Reattach most_recent_parent if it exists
    for agent in agents:
        this_agent_data = get_agent_data_by_name(agent.name, agent_data)
        if this_agent_data:
            most_recent_parent_name = this_agent_data.get("most_recent_parent_name", "")
            if most_recent_parent_name:
                parent_agent = get_agent_by_name(most_recent_parent_name, agents)
                if parent_agent:
                    agent.most_recent_parent = parent_agent

    # Attach children
    logger.info("Adding children agents to parent agents")
    for agent in agents:
        agent.children = {
            potential_child.name: potential_child
            for potential_child in agents
            if potential_child.name in agent.children_names
        }

    # Generate transfer functions for child agents
    logger.info("Generating transfer functions for transferring to children agents")
    transfer_functions = {
        agent.name: create_transfer_function_to_agent(agent)
        for agent in agents
    }

    # Add transfer functions to parent agents for each child
    logger.info("Adding transfer functions for parents to transfer to children")
    for agent in agents:
        for child in agent.children.values():
            agent.child_functions[child.name] = transfer_functions[child.name]

    # Add parent-related instructions
    logger.info("Adding child transfer-related instructions to parent agents")
    for agent in agents:
        if agent.children:
            add_transfer_instructions_to_parent_agents(agent, agent.children, transfer_functions)

    # Generate and attach transfer functions for children to call parents
    logger.info("Generating duplicate transfer functions for children to transfer to parent agents")
    for agent in agents:
        for child in agent.children.values():
            func_to_parent = create_transfer_function_to_parent_agent(
                parent_agent=agent,
                children_aware_of_parent=children_aware_of_parent,
                transfer_functions=transfer_functions
            )
            child.candidate_parent_functions[agent.name] = func_to_parent

    # Inject instructions for child agents who have candidate parent functions
    for agent in agents:
        if agent.candidate_parent_functions and agent.type != "escalation":
            add_transfer_instructions_to_child_agents(
                child=agent,
                children_aware_of_parent=children_aware_of_parent
            )

    # Now set the parent function to the correct (most recent) parent
    for agent in agents:
        if agent.most_recent_parent:
            parent_name = agent.most_recent_parent.name
            assert parent_name in agent.candidate_parent_functions, (
                f"Most recent parent {parent_name} not found in candidate "
                f"parent functions for agent {agent.name}"
            )
            agent.parent_function = agent.candidate_parent_functions[parent_name]

    # Finally add a universal system message to all agents
    for agent in agents:
        add_universal_system_message_to_agent(agent, universal_sys_msg)

    return agents


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

    return Response(
        messages=messages,
        tokens_used=tokens_used,
        agent=agent,
        error_msg=error_msg
    )


def run(
    agent,
    messages,
    execute_tools=True,
    external_tools=None,
    localize_history=True,
    parent_has_child_history=True,
    max_messages_per_turn=10,
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

    # Initialize default parameters
    if external_tools is None:
        external_tools = []
    if tokens_used is None:
        tokens_used = {}

    # Initialize the Swarm client
    swarm_client = Swarm()

    # Run the agent
    response = swarm_client.run(
        agent=agent,
        messages=messages,
        execute_tools=execute_tools,
        external_tools=external_tools,
        localize_history=localize_history,
        parent_has_child_history=parent_has_child_history,
        max_messages_per_turn=max_messages_per_turn,
        tokens_used=tokens_used
    )

    logger.info(f"Completed Swarm run for agent: {agent.name}")
    return response