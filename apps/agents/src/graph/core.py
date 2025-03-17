from copy import deepcopy

import logging
from .types import AgentRole
from .helpers.access import (
    get_agent_by_name,
    get_external_tools, pop_agent_config_by_type
)
from .helpers.state import (
    add_recent_messages_to_history, construct_state_from_response, reset_current_turn, reset_current_turn_agent_history
)
from .helpers.instructions import (
    get_universal_system_message
)
from .helpers.control import get_latest_assistant_msg, get_latest_non_assistant_messages, get_last_agent_name
from .swarm_wrapper import run as swarm_run, create_response, get_agents

# Create a dedicated logger for swarm wrapper
logger = logging.getLogger("graph")
logger.setLevel(logging.INFO)


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

def create_final_response(response, turn_messages, messages, tokens_used, all_agents, return_diff_messages):
    """
    Constructs the final response data (messages, tokens_used, updated state) that a caller would need.
    """
    # Ensure response has a messages attribute
    if not hasattr(response, 'messages'):
        response.messages = []

    # Assign the appropriate messages to the response
    response.messages = turn_messages if return_diff_messages else messages + turn_messages

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
    messages, start_agent_name, agent_configs, tool_configs, available_tool_mappings={},
    localize_history=True, return_diff_messages=True, prompt_configs=[], start_turn_with_start_agent=False,
    children_aware_of_parent=False, parent_has_child_history=True, state={}, additional_tool_configs=[],
    error_tool_call=True, max_messages_per_turn=10, max_messages_per_error_escalation_turn=4,
    escalate_errors=True, max_overall_turns=10
):
    """
    Coordinates a single 'turn' of conversation or processing among agents.
    Includes validation, agent setup, optional greeting logic, error handling, and post-processing steps.
    """
    logger.info("Running stateless turn")

    # Sort messages by the specified ordering
    #messages = order_messages(messages)

    # Merge any additional tool configs
    tool_configs = tool_configs + additional_tool_configs

    # Determine if this is a greeting turn
    greeting_turn = not any(msg.get("role") != "system" for msg in messages)
    turn_messages = []
    # Initialize tokens_used as a dictionary
    tokens_used = {"total": 0, "prompt": 0, "completion": 0}

    # Extract special agent configs
    post_processing_agent_config, agent_configs = pop_agent_config_by_type(agent_configs, AgentRole.POST_PROCESSING.value)
    guardrails_agent_config, agent_configs = pop_agent_config_by_type(agent_configs, AgentRole.GUARDRAILS.value)

    agent_data = state.get("agent_data", [])
    universal_sys_msg = ""

    # If not a greeting turn, localize the last user or system messages
    if not greeting_turn:
        latest_assistant_msg = get_latest_assistant_msg(messages)
        universal_sys_msg = get_universal_system_message(messages)
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

        # Localize history
        if msg_type == "user":
            messages = reset_current_turn(messages)
            agent_data = reset_current_turn_agent_history(agent_data, [last_agent_name])
        #agent_data = clean_up_history(agent_data)
        agent_data = add_recent_messages_to_history(
            recent_messages=latest_non_assistant_msgs,
            last_agent_name=last_agent_name,
            agent_data=agent_data,
            messages=messages,
            parent_has_child_history=parent_has_child_history
        )
    else:
        # For a greeting turn, we assume the last agent is the start_agent_name
        last_agent_name = start_agent_name

    state["agent_data"] = agent_data

    # Initialize all agents
    logger.info("Initializing agents")
    all_agents, new_agents = get_agents(
        agent_configs=agent_configs,
        tool_configs=tool_configs,
        available_tool_mappings=available_tool_mappings,
        agent_data=agent_data,
        localize_history=localize_history,
        start_turn_with_start_agent=start_turn_with_start_agent,
        children_aware_of_parent=children_aware_of_parent,
        universal_sys_msg=universal_sys_msg
    )
    # Prepare escalation agent

    # Get the last agent and validate
    last_agent = get_agent_by_name(last_agent_name, all_agents)
    last_new_agent = get_agent_by_name(last_agent_name, new_agents)

    # Gather external tools for Swarm
    external_tools = get_external_tools(tool_configs)
    logger.info(f"Found {len(external_tools)} external tools")

    # If no validation error yet, proceed with the main run

    response = swarm_run(
        agent=last_new_agent,
        messages=messages,
        execute_tools=True,
        external_tools=external_tools,
        localize_history=localize_history,
        parent_has_child_history=parent_has_child_history,
        max_messages_per_turn=max_messages_per_turn,
        tokens_used=tokens_used
    )

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
            "sender": last_agent.name,
            "created_at": None,
            "response_type": "internal"
        }

        # Add the converted message to response messages
        response.messages.append(standard_message)

    # Use a dictionary for tokens_used instead of a hard-coded integer
    tokens_used = {"total": 100, "prompt": 50, "completion": 50}  # Dummy values as placeholders

    # Ensure turn_messages can be extended with response.messages
    if hasattr(response, 'messages') and isinstance(response.messages, list):
        turn_messages.extend(response.messages)

    logger.info(f"Completed run of agent: {last_agent.name}")


    # Otherwise, duplicate the last response as external
    logger.info("No post-processing agent found. Duplicating last response and setting to external.")
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
            agent=last_agent,
            error_msg=''
        )

        # Ensure response has messages attribute
        if hasattr(response, 'messages') and isinstance(response.messages, list):
            turn_messages.extend(response.messages)

    # Finalize the response
    return create_final_response(
        response=response,
        turn_messages=turn_messages,
        messages=messages,
        tokens_used=tokens_used,
        all_agents=all_agents,
        return_diff_messages=return_diff_messages
    )
