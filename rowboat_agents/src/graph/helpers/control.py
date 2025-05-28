from .access import get_agent_config_by_name, get_agent_data_by_name
from src.graph.types import ControlType

def get_last_agent_name(state, agent_configs, start_agent_name, msg_type, latest_assistant_msg, start_turn_with_start_agent):
    default_last_agent_name = state.get("last_agent_name", '')
    last_agent_config = get_agent_config_by_name(default_last_agent_name, agent_configs)
    specific_agent_data = get_agent_data_by_name(default_last_agent_name, state.get("agent_data", []))
    
    # Overrides for special cases
    print("Setting agent control based on last agent and control type")
    if msg_type == "tool":
        last_agent_name = default_last_agent_name
        assert last_agent_name == latest_assistant_msg.get("sender", ''), "Last agent name does not match sender of latest assistant message during tool call handling"
    
    elif start_turn_with_start_agent:
        last_agent_name = start_agent_name
    
    else:
        control_type = last_agent_config.get("controlType", ControlType.RETAIN.value)
        if control_type == ControlType.PARENT_AGENT.value:
            last_agent_name = specific_agent_data.get("most_recent_parent_name", None) if specific_agent_data else None
            if not last_agent_name:
                print("Most recent parent is empty, defaulting to same agent instead")
                last_agent_name = default_last_agent_name
        elif control_type == ControlType.START_AGENT.value:
            last_agent_name = start_agent_name
        else:
            last_agent_name = default_last_agent_name
    
    if default_last_agent_name != last_agent_name:
        print(f"Last agent name changed from {default_last_agent_name} to {last_agent_name} due to control settings")
        
    return last_agent_name


def get_latest_assistant_msg(messages):
    # Find the latest message with role assistant
    for i in range(len(messages)-1, -1, -1):
        if messages[i].get("role") == "assistant":
            return messages[i]
    return None

def get_latest_non_assistant_messages(messages):
    # Find all messages after the last assistant message
    for i in range(len(messages)-1, -1, -1):
        if messages[i].get("role") == "assistant":
            return messages[i+1:]
    return messages