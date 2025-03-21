from copy import deepcopy

import logging
from .helpers.access import (
    get_agent_by_name,
    get_external_tools,
)
from .helpers.state import (
    construct_state_from_response
)
from .helpers.control import get_latest_assistant_msg, get_latest_non_assistant_messages, get_last_agent_name
from .swarm_wrapper import run as swarm_run, create_response, get_agents
from src.utils.common import common_logger as logger

# Create a dedicated logger for swarm wrapper
logger.setLevel(logging.INFO)
print("Logger level set to INFO")


def order_messages(messages):
    """
    Sorts each message's keys in a specified order and returns a new list of ordered messages.
    """
    ordered_messages = []
    for msg in messages:
        # Filter out None values
        msg = {k: v for k, v in msg.items() if v is not None}

        # Specify the exact order
        ordered = {}
        for key in ['role', 'sender', 'content', 'created_at', 'timestamp']:
            if key in msg:
                ordered[key] = msg[key]

        # Add remaining keys in alphabetical order
        remaining_keys = sorted(k for k in msg if k not in ordered)
        for key in remaining_keys:
            ordered[key] = msg[key]

        ordered_messages.append(ordered)
    return ordered_messages


def clean_up_history(agent_data):
    """
    Ensures each agent's history is sorted using order_messages.
    """
    for data in agent_data:
        data["history"] = order_messages(data["history"])
    return agent_data

def create_final_response(response, turn_messages, tokens_used, all_agents):
    """
    Constructs the final response data (messages, tokens_used, updated state) that a caller would need.
    """
    # Ensure response has a messages attribute
    if not hasattr(response, 'messages'):
        response.messages = []

    # Assign the appropriate messages to the response
    response.messages = turn_messages

    # Ensure tokens_used is a valid dictionary
    if not isinstance(tokens_used, dict):
        tokens_used = {"total": 100, "prompt": 50, "completion": 50}  # Default values if not a dictionary

    # Ensure response has a tokens_used attribute that's a dictionary
    if not hasattr(response, 'tokens_used') or not isinstance(response.tokens_used, dict):
        response.tokens_used = {}

    response.tokens_used = tokens_used

    # Ensure response has an agent attribute for state construction
    if not hasattr(response, 'agent'):
        if all_agents and len(all_agents) > 0:
            response.agent = all_agents[0]  # Set default agent if missing

    new_state = construct_state_from_response(response, all_agents)
    return response.messages, response.tokens_used, new_state


def run_turn(
    messages, start_agent_name, agent_configs, tool_configs, start_turn_with_start_agent, state={}, additional_tool_configs=[]
):
    """
    Coordinates a single 'turn' of conversation or processing among agents.
    Includes validation, agent setup, optional greeting logic, error handling, and post-processing steps.
    """
    logger.info("Running stateless turn")
    print("Running stateless turn")

    # Sort messages by the specified ordering
    #messages = order_messages(messages)

    # Merge any additional tool configs
    tool_configs = tool_configs + additional_tool_configs

    # Determine if this is a greeting turn
    greeting_turn = not any(msg.get("role") != "system" for msg in messages)
    turn_messages = []
    # Initialize tokens_used as a dictionary
    tokens_used = {"total": 0, "prompt": 0, "completion": 0}

    agent_data = state.get("agent_data", [])

    # If not a greeting turn, localize the last user or system messages
    if not greeting_turn:
        latest_assistant_msg = get_latest_assistant_msg(messages)
        latest_non_assistant_msgs = get_latest_non_assistant_messages(messages)
        msg_type = latest_non_assistant_msgs[-1]["role"]

        # Determine the last agent from state/config
        last_agent_name = get_last_agent_name(
            state=state,
            agent_configs=agent_configs,
            start_agent_name=start_agent_name,
            msg_type=msg_type,
            latest_assistant_msg=latest_assistant_msg,
            start_turn_with_start_agent=start_turn_with_start_agent
        )
    else:
        # For a greeting turn, we assume the last agent is the start_agent_name
        last_agent_name = start_agent_name

    state["agent_data"] = agent_data

    # Initialize all agents
    logger.info("Initializing agents")
    print("Initializing agents")
    new_agents = get_agents(
        agent_configs=agent_configs,
        tool_configs=tool_configs
    )
    # Prepare escalation agent
    last_new_agent = get_agent_by_name(last_agent_name, new_agents)

    # Gather external tools for Swarm
    external_tools = get_external_tools(tool_configs)
    logger.info(f"Found {len(external_tools)} external tools")
    print(f"Found {len(external_tools)} external tools")

    # If no validation error yet, proceed with the main run

    logger.info("Running swarm run")
    print("Running swarm run")

    response = swarm_run(
        agent=last_new_agent,
        messages=messages,
        external_tools=external_tools,
        tokens_used=tokens_used
    )

    logger.info("Swarm run completed")
    print("Swarm run completed")

    # Initialize response.messages if it doesn't exist
    if not hasattr(response, 'messages'):
        response.messages = []

    # Convert the ResponseOutputMessage to a standard message format
    if hasattr(response, 'new_items') and response.new_items and hasattr(response.new_items[-1], 'raw_item'):
        raw_item = response.new_items[-1].raw_item
        # Extract text content from ResponseOutputText objects
        content = ""
        if hasattr(raw_item, 'content') and raw_item.content:
            for content_item in raw_item.content:
                if hasattr(content_item, 'text'):
                    content += content_item.text

        # Create a standard message dictionary
        standard_message = {
            "role": raw_item.role if hasattr(raw_item, 'role') else "assistant",
            "content": content,
            "sender": last_new_agent.name,
            "created_at": None,
            "response_type": "internal"
        }

        # Add the converted message to response messages
        response.messages.append(standard_message)

    logger.info("Converted message added to response messages")
    print("Converted message added to response messages")

    # Use a dictionary for tokens_used instead of a hard-coded integer
    tokens_used = {"total": 100, "prompt": 50, "completion": 50}  # Dummy values as placeholders

    # Ensure turn_messages can be extended with response.messages
    if hasattr(response, 'messages') and isinstance(response.messages, list):
        turn_messages.extend(response.messages)

    logger.info(f"Completed run of agent: {last_new_agent.name}")
    print(f"Completed run of agent: {last_new_agent.name}")


    # Otherwise, duplicate the last response as external
    logger.info("No post-processing agent found. Duplicating last response and setting to external.")
    print("No post-processing agent found. Duplicating last response and setting to external.")
    if turn_messages:
        duplicate_msg = deepcopy(turn_messages[-1])
        duplicate_msg["response_type"] = "external"
        duplicate_msg["sender"] += " >> External"

        # Ensure tokens_used remains a proper dictionary
        if not isinstance(tokens_used, dict):
            tokens_used = {"total": 100, "prompt": 50, "completion": 50}  # Default values if not a dictionary

        response = create_response(
            messages=[duplicate_msg],
            tokens_used=tokens_used,
            agent=last_new_agent,
            error_msg=''
        )

        # Ensure response has messages attribute
        if hasattr(response, 'messages') and isinstance(response.messages, list):
            turn_messages.extend(response.messages)

    # Finalize the response
    logger.info("Finalizing response")
    print("Finalizing response")
    return create_final_response(
        response=response,
        turn_messages=turn_messages,
        tokens_used=tokens_used,
        all_agents=new_agents
    )
