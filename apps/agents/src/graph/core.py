import os
import sys
from copy import deepcopy

from src.swarm.types import Agent
from src.swarm.core import Swarm

from .guardrails import post_process_response
from .tools import create_error_tool_call
from .types import AgentRole, PromptType, ErrorType
from .helpers.access import get_agent_data_by_name, get_agent_by_name, get_agent_config_by_name, get_tool_config_by_name, get_tool_config_by_type, get_external_tools, get_prompt_by_type, pop_agent_config_by_type, get_agent_by_type
from .helpers.transfer import create_transfer_function_to_agent, create_transfer_function_to_parent_agent
from .helpers.state import add_recent_messages_to_history, construct_state_from_response, reset_current_turn, reset_current_turn_agent_history
from .helpers.instructions import add_transfer_instructions_to_child_agents, add_transfer_instructions_to_parent_agents, add_rag_instructions_to_agent, add_error_escalation_instructions, get_universal_system_message, add_universal_system_message_to_agent
from .helpers.control import get_latest_assistant_msg, get_latest_non_assistant_messages, get_last_agent_name
from src.swarm.types import Response
from datetime import datetime

from src.utils.common import common_logger
logger = common_logger

def order_messages(messages):
    # Arrange keys in specified order
    ordered_messages = []
    for msg in messages:
        ordered = {}
        msg = {k: v for k, v in msg.items() if v is not None}
        # Add keys in specified order if they exist
        for key in ['role', 'sender', 'content', 'created_at', 'timestamp']:
            if key in msg:
                ordered[key] = msg[key]
        # Add remaining keys in alphabetical order
        for key in sorted(msg.keys()):
            if key not in ['role', 'sender', 'content', 'created_at', 'timestamp']:
                ordered[key] = msg[key]
        ordered_messages.append(ordered)

    return ordered_messages

def clean_up_history(agent_data):
    for data in agent_data:
        data["history"] = order_messages(data["history"])
    return agent_data

def clear_agent_fields(agent):
    agent.children = {}
    agent.parent_function = None
    agent.candidate_parent_functions = {}
    agent.child_functions = {}
    if agent.most_recent_parent:
        agent.history = []
    
    return agent

def get_agents(agent_configs, tool_configs, localize_history, available_tool_mappings, agent_data, start_turn_with_start_agent, children_aware_of_parent, universal_sys_msg):
    # Create Agent objects
    agents = []

    if not isinstance(agent_configs, list):
        raise ValueError("Agents config is not a list in get_agents")

    if not isinstance(tool_configs, list):
        raise ValueError("Tools config is not a list in get_agents")

    for agent_config in agent_configs:
        logger.debug(f"Processing config for agent: {agent_config['name']}")
        
        # Get tools for this agent
        external_tools = []
        internal_tools = []
        candidate_parent_functions = {}
        child_functions = {}

        logger.debug(f"Finding tools for agent {agent_config['name']}")
        logger.debug(f"Agent {agent_config['name']} has {len(agent_config['tools'])} configured tools")

        if agent_config.get("hasRagSources", False):
            rag_tool_name = get_tool_config_by_type(tool_configs, "rag").get("name", "")
            agent_config["tools"].append(rag_tool_name)
            agent_config = add_rag_instructions_to_agent(agent_config, rag_tool_name)

        for tool_name in agent_config["tools"]:
            logger.debug(f"Looking for tool config: {tool_name}")
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
        
        history = []
        this_agent_data = get_agent_data_by_name(agent_config["name"], agent_data)
        if this_agent_data:
            if localize_history:
                history = this_agent_data.get("history", [])
                
        # Create agent
        logger.debug(f"Creating Agent object for {agent_config['name']}")
        logger.debug(f"Using model: {agent_config['model']}")
        logger.debug(f"Number of tools being added: Internal - {len(internal_tools)} | External - {len(external_tools)}")

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

    # Adding most recent parents to agents
    for agent in agents:
        most_recent_parent = None
        this_agent_data = get_agent_data_by_name(agent.name, agent_data)
        if this_agent_data:
            most_recent_parent_name = this_agent_data.get("most_recent_parent_name", "")
            if most_recent_parent_name:
                most_recent_parent = get_agent_by_name(most_recent_parent_name, agents) if most_recent_parent_name else None
                if most_recent_parent:
                    agent.most_recent_parent = most_recent_parent

    # Adding children agents to parent agents
    logger.info("Adding children agents to parent agents")
    for agent in agents:
        agent.children = {agent_.name: agent_ for agent_ in agents if agent_.name in agent.children_names}

    # Generate transfer functions for transferring to children agents
    logger.info("Generating transfer functions for transferring to children agents")
    transfer_functions = {
        agent.name: create_transfer_function_to_agent(agent) 
        for agent in agents
    }

    # Add transfer functions for parents to transfer to children
    logger.info("Adding transfer functions for parents to transfer to children")
    for agent in agents:
        for child in agent.children.values():
            agent.child_functions[child.name] = transfer_functions[child.name]

    # Add transfer-related instructions to parent agents
    logger.info("Adding child transfer-related instructions to parent agents")
    for agent in agents:
        if agent.children:
            agent = add_transfer_instructions_to_parent_agents(agent, agent.children, transfer_functions)

    # Generate and append duplicate transfer functions for children to transfer to parent agents
    logger.info("Generating duplicate transfer functions for children to transfer to parent agents")
    for agent in agents:
        for child in agent.children.values():
            func = create_transfer_function_to_parent_agent(
                parent_agent=agent, 
                children_aware_of_parent=children_aware_of_parent, 
                transfer_functions=transfer_functions
            )
            child.candidate_parent_functions[agent.name] = func

    for agent in agents:
        if agent.candidate_parent_functions and agent.type != "escalation":
            agent = add_transfer_instructions_to_child_agents(
                child=agent, 
                children_aware_of_parent=children_aware_of_parent
            )
        
    for agent in agents:
        if agent.most_recent_parent:
            assert agent.most_recent_parent.name in agent.candidate_parent_functions, f"Most recent parent {agent.most_recent_parent.name} not found in candidate parent functions for agent {agent.name}"
            agent.parent_function = agent.candidate_parent_functions[agent.most_recent_parent.name]

    for agent in agents:
        agent = add_universal_system_message_to_agent(agent, universal_sys_msg)
        
    return agents

def check_request_validity(messages, agent_configs, tool_configs, prompt_configs, max_overall_turns):

    error_msg = ""
    error_type = ErrorType.ESCALATE.value
    
    # Limits checks
    external_messages_count = sum(1 for msg in messages if msg.get("response_type") == "external")
    if external_messages_count >= max_overall_turns:
        error_msg = f"Max overall turns reached: {max_overall_turns}"

    # Empty checks
    if not messages:
        error_msg = "Messages list is empty"
    
    # Empty checks --> Fatal
    if not agent_configs:
        error_msg = "Agent configs list is empty"
        error_type = ErrorType.FATAL.value

    # Type checks --> Fatal
    for arg in [messages, agent_configs, tool_configs, prompt_configs]:
        if not isinstance(arg, list):
            error_msg = f"{arg} is not a list"
            error_type = ErrorType.FATAL.value
    
    # Post processing agent, guardrails and escalation agent check - there should be at max one agent with type "post_processing_agent", "guardrails_agent" and "escalation_agent" respectively --> Fatal
    post_processing_agent_count = sum(1 for ac in agent_configs if ac.get("type", "") == AgentRole.POST_PROCESSING.value)
    guardrails_agent_count = sum(1 for ac in agent_configs if ac.get("type", "") == AgentRole.GUARDRAILS.value)
    escalation_agent_count = sum(1 for ac in agent_configs if ac.get("type", "") == AgentRole.ESCALATION.value)
    if post_processing_agent_count > 1 or guardrails_agent_count > 1 or escalation_agent_count > 1:
        error_msg = "Invalid post processing agent or guardrails agent count - expected at most 1"
        error_type = ErrorType.FATAL.value
    
    # All agent config should have: name, instructions, model --> Fatal
    for agent_config in agent_configs:
        if not all(key in agent_config for key in ["name", "instructions", "model"]):
            missing_keys = [key for key in ["name", "instructions", "tools", "model"] if key not in agent_config]
            error_msg = f"Invalid agent config - missing keys: {missing_keys}"
            error_type = ErrorType.FATAL.value

    # All tool configs should have: name, parameters --> Fatal
    for tool_config in tool_configs:
        if not all(key in tool_config for key in ["name", "parameters"]):
            missing_keys = [key for key in ["name", "parameters"] if key not in tool_config]
            error_msg = f"Invalid tool config - missing keys: {missing_keys}"
            error_type = ErrorType.FATAL.value
    
    # Check for cycles in the agent config graph. Raise error if cycle is found, along with the agents involved in the cycle. 
    def find_cycles(agent_name, agent_configs, visited=None, path=None):
        if visited is None:
            visited = set()
        if path is None:
            path = []
            
        visited.add(agent_name)
        path.append(agent_name)
        
        agent_config = get_agent_config_by_name(agent_name, agent_configs)
        if not agent_config:
            return None
            
        for child_name in agent_config.get("connectedAgents", []):
            if child_name in path:
                cycle = path[path.index(child_name):]
                cycle.append(child_name)
                return cycle
                
            if child_name not in visited:
                cycle = find_cycles(child_name, agent_configs, visited, path)
                if cycle:
                    return cycle
                    
        path.pop()
        return None

    for agent_config in agent_configs:
        if agent_config.get("name") in agent_config.get("connectedAgents", []):
            error_msg = f"Cycle detected in agent config graph - agent {agent_config.get('name')} is connected to itself"
            
        cycle = find_cycles(agent_config.get("name"), agent_configs)
        if cycle:
            cycle_str = " -> ".join(cycle)
            error_msg = f"Cycle detected in agent config graph: {cycle_str}"
            
    return error_msg, error_type

def handle_error(error_tool_call, error_msg, return_diff_messages, messages, turn_messages, state, tokens_used):
    resp_messages = turn_messages if return_diff_messages else messages + turn_messages
    resp_messages.extend([create_error_tool_call(error_msg)])
    if error_tool_call:
        return resp_messages, tokens_used, state
    else:
        raise ValueError(error_msg)
    
def create_final_response(response, turn_messages, messages, tokens_used, all_agents, return_diff_messages):
    response.messages = turn_messages if return_diff_messages else messages + turn_messages
    response.tokens_used = tokens_used
    new_state = construct_state_from_response(response, all_agents)
    return response.messages, response.tokens_used, new_state

def run_turn(messages, start_agent_name, agent_configs, tool_configs, available_tool_mappings={}, localize_history=True, return_diff_messages=True, prompt_configs=[], start_turn_with_start_agent=False, children_aware_of_parent=False, parent_has_child_history=True, state={}, additional_tool_configs=[], error_tool_call=True, max_messages_per_turn=10, max_messages_per_error_escalation_turn=4, escalate_errors=True, max_overall_turns=10):

    greeting_turn = True if not any(msg.get("role") != "system" for msg in messages) else False
    logger.info("Running stateless turn")
    turn_messages = []
    tokens_used = {}
    messages = order_messages(messages)
    tool_configs = tool_configs + additional_tool_configs

    validation_error_msg, validation_error_type = check_request_validity(
        messages=messages,
        agent_configs=agent_configs,
        tool_configs=tool_configs,
        prompt_configs=prompt_configs,
        max_overall_turns=max_overall_turns
    )

    if validation_error_msg and validation_error_type == ErrorType.FATAL.value:
        logger.error(validation_error_msg)
        return handle_error(
            error_tool_call=error_tool_call,
            error_msg=validation_error_msg,
            return_diff_messages=return_diff_messages,
            messages=messages,
            turn_messages=turn_messages,
            state=state,
            tokens_used=tokens_used
        )        
        
    post_processing_agent_config, agent_configs = pop_agent_config_by_type(agent_configs, AgentRole.POST_PROCESSING.value)
    guardrails_agent_config, agent_configs = pop_agent_config_by_type(agent_configs, AgentRole.GUARDRAILS.value)
    agent_data = state.get("agent_data", [])
    universal_sys_msg = ""
    
    if not greeting_turn:
        latest_assistant_msg = get_latest_assistant_msg(messages)
        universal_sys_msg = get_universal_system_message(messages)
        latest_non_assistant_msgs = get_latest_non_assistant_messages(messages)
        msg_type = latest_non_assistant_msgs[-1]["role"]
    
        last_agent_name = get_last_agent_name(
            state=state,
            agent_configs=agent_configs,
            start_agent_name=start_agent_name,
            msg_type=msg_type,
            latest_assistant_msg=latest_assistant_msg,
            start_turn_with_start_agent=start_turn_with_start_agent
        )
        
        logger.info("Localizing message history")
        if msg_type == "user":
            messages = reset_current_turn(messages)
            agent_data = reset_current_turn_agent_history(agent_data, [last_agent_name])
        agent_data = clean_up_history(agent_data)
        agent_data = add_recent_messages_to_history(
            recent_messages=latest_non_assistant_msgs,
            last_agent_name=last_agent_name,
            agent_data=agent_data,
            messages=messages,
            parent_has_child_history=parent_has_child_history
        )
    
    state["agent_data"] = agent_data
    logger.info("Initializing agents")
    all_agents = get_agents(
        agent_configs=agent_configs,
        tool_configs=tool_configs,
        available_tool_mappings=available_tool_mappings,
        agent_data=state.get("agent_data", []),
        localize_history=localize_history,
        start_turn_with_start_agent=start_turn_with_start_agent,
        children_aware_of_parent=children_aware_of_parent,
        universal_sys_msg=universal_sys_msg
    )
    if not all_agents:
        logger.error("No agents initialized")
        return handle_error(
            error_tool_call=error_tool_call,
            error_msg="No agents initialized"
        )

    if greeting_turn:
        greeting_msg = get_prompt_by_type(prompt_configs, PromptType.GREETING.value)
        if not greeting_msg:
            logger.error("Greeting prompt not found and messages is empty")
            return handle_error(
                error_tool_call=error_tool_call,
                error_msg="Greeting prompt not found and messages is empty",
                return_diff_messages=return_diff_messages,
                messages=messages,
                turn_messages=turn_messages,
                state=state,
                tokens_used=tokens_used
            )
        
        greeting_msg_internal = {
            "content": greeting_msg,
            "role": "assistant",
            "sender": start_agent_name,
            "response_type": "internal",
            "created_at": datetime.now().isoformat(),
            "current_turn": True
        }
        greeting_msg_external = deepcopy(greeting_msg_internal)
        greeting_msg_external["response_type"] = "external"
        greeting_msg_external["sender"] = greeting_msg_external["sender"] + ' >> External'
        turn_messages.extend([greeting_msg_internal, greeting_msg_external])

        response = Response(
            messages=turn_messages,
            tokens_used={},
            agent=get_agent_by_name(start_agent_name, all_agents),
            error_msg=''
        )
        
        return create_final_response(
            response=response,
            turn_messages=turn_messages,
            messages=messages,
            tokens_used=tokens_used,
            all_agents=all_agents,
            return_diff_messages=return_diff_messages
        )
    
    error_escalation_agent = deepcopy(get_agent_by_type(all_agents, AgentRole.ESCALATION.value))
    if not error_escalation_agent:
        logger.error("Escalation agent not found")
        return handle_error(
            error_tool_call=error_tool_call,
            error_msg="Escalation agent not found",
            return_diff_messages=return_diff_messages,
            messages=messages,
            turn_messages=turn_messages,
            state=state,
            tokens_used=tokens_used
        )

    error_escalation_agent = clear_agent_fields(error_escalation_agent)
    error_escalation_agent = add_error_escalation_instructions(error_escalation_agent)

    logger.info(f"Initialized {len(all_agents)} agents")
    
    logger.debug("Getting last agent")
    last_agent = get_agent_by_name(last_agent_name, all_agents)
    
    if not last_agent:
        logger.error("Last agent not found")
        return handle_error(
            error_tool_call=error_tool_call,
            error_msg="Last agent not found",
            return_diff_messages=return_diff_messages,
            messages=messages,
            state=state
        )
    
    external_tools = get_external_tools(tool_configs)
    logger.info(f"Found {len(external_tools)} external tools")
    
    logger.debug("Initializing Swarm client")
    swarm_client = Swarm()
    
    if not validation_error_msg:
        response = swarm_client.run(
            agent=last_agent,
            messages=messages,
            execute_tools=True,
            external_tools=external_tools,
            localize_history=localize_history,
            parent_has_child_history=parent_has_child_history,
            max_messages_per_turn=max_messages_per_turn,
            tokens_used=tokens_used
        )
        tokens_used = response.tokens_used
        last_agent = response.agent
        response.messages = order_messages(response.messages)
        turn_messages.extend(response.messages)
        logger.info(f"Completed run of agent: {last_agent.name}")
    
    if validation_error_msg and validation_error_type == ErrorType.ESCALATE.value or response.error_msg:
        logger.info(f"Error raised in turn: {response.error_msg}")
        response_sender_agent_name = response.agent.name
        if escalate_errors and response_sender_agent_name != error_escalation_agent.name:
            response = client.run(
                agent=error_escalation_agent,
                messages=[],
                execute_tools=True,
                external_tools=external_tools,
                localize_history=False,
                parent_has_child_history=False,
                max_messages_per_turn=max_messages_per_error_escalation_turn,
                tokens_used=tokens_used
            )
            tokens_used = response.tokens_used
            last_agent = response.agent
            response.messages = order_messages(response.messages)
            turn_messages.extend(response.messages)
            logger.info(f"Completed run of escalation agent: {error_escalation_agent.name}")
            
            if response.error_msg:
                logger.info(f"Error raised in escalation turn: {response.error_msg}")
                return handle_error(
                    error_tool_call=error_tool_call,
                    error_msg=response.error_msg,
                    return_diff_messages=return_diff_messages,
                    messages=messages,
                    turn_messages=turn_messages,
                    state=state,
                    tokens_used=tokens_used
                )
        else:
            logger.info(f"Error raised in turn: {response.error_msg}")
            return handle_error(
                error_tool_call=error_tool_call,
                error_msg=response.error_msg,
                return_diff_messages=return_diff_messages,
                messages=messages,
                turn_messages=turn_messages,
                state=state,
                tokens_used=tokens_used
            )
    
    if post_processing_agent_config:
        response = post_process_response(
            messages=turn_messages,
            post_processing_agent_name=post_processing_agent_config.get("name", "Post Processing agent"),
            post_process_instructions=post_processing_agent_config.get("instructions", ""),
            style_prompt=get_prompt_by_type(prompt_configs, PromptType.STYLE.value),
            context='',
            model=post_processing_agent_config.get("model", "gpt-4o"),
            tokens_used=tokens_used,
            last_agent=last_agent
        )
        tokens_used = response.tokens_used
        response.messages = order_messages(response.messages)
        turn_messages.extend(response.messages)
        logger.info("Response post-processed")
    
    else:
        logger.info("No post-processing agent found. Duplicating last response and setting to external.")
        duplicate_msg = deepcopy(turn_messages[-1])
        duplicate_msg["response_type"] = "external"
        duplicate_msg["sender"] = duplicate_msg["sender"] + ' >> External'
        response = Response(
            messages=[duplicate_msg],
            tokens_used=tokens_used,
            agent=last_agent,
            error_msg=''
        )
        response.messages = order_messages(response.messages)
        turn_messages.extend(response.messages)
        logger.info("Last response duplicated and set to external")

    if guardrails_agent_config:
        logger.info("Guardrails agent not implemented (ignoring)")
        pass

    if not state or not state.get("last_agent_name"):
        logger.error("State is empty or last agent name is not set")
        raise ValueError("State is empty or last agent name is not set")
    
    return create_final_response(
        response=response,
        turn_messages=turn_messages,
        messages=messages,
        tokens_used=tokens_used,
        all_agents=all_agents,
        return_diff_messages=return_diff_messages
    )