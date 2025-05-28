from src.utils.common import common_logger
logger = common_logger

def get_external_tools(tool_configs):
    logger.debug("Getting external tools")
    tools = [tool["name"] for tool in tool_configs]
    logger.debug(f"Found {len(tools)} external tools")
    return tools

def get_agent_by_name(agent_name, agents):
    agent = next((a for a in agents if getattr(a, "name", None) == agent_name), None)
    if not agent:
        logger.error(f"Agent with name {agent_name} not found")
        raise ValueError(f"Agent with name {agent_name} not found")
    return agent

def get_agent_config_by_name(agent_name, agent_configs):
    agent_config = next((ac for ac in agent_configs if ac.get("name") == agent_name), None)
    if not agent_config:
        logger.error(f"Agent config with name {agent_name} not found")
        raise ValueError(f"Agent config with name {agent_name} not found")
    return agent_config

def pop_agent_config_by_type(agent_configs, agent_type):
    agent_config = next((ac for ac in agent_configs if ac.get("type") == agent_type), None)
    if agent_config:
        agent_configs.remove(agent_config)
    return agent_config, agent_configs

def get_agent_by_type(agents, agent_type):
    return next((a for a in agents if a.type == agent_type), None)

def get_prompt_by_type(prompt_configs, prompt_type):
    return next((pc.get("prompt") for pc in prompt_configs if pc.get("type") == prompt_type), None)

def get_agent_data_by_name(agent_name, agent_data):
    for data in agent_data:
        name = data.get("name", "")
        if name == agent_name:
            return data
    
    return None

def get_tool_config_by_name(tool_configs, tool_name):
    return next((tc for tc in tool_configs if tc.get("name", "") == tool_name), None)

def get_tool_config_by_type(tool_configs, tool_type):
    return next((tc for tc in tool_configs if tc.get("type", "") == tool_type), None)
