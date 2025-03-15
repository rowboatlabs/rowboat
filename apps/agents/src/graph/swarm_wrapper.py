from src.swarm.core import Swarm
from src.swarm.types import Agent as SwarmAgent, Response as SwarmResponse
from src.utils.common import common_logger

logger = common_logger


# Re-export the types from src.swarm.types
Agent = SwarmAgent
Response = SwarmResponse


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