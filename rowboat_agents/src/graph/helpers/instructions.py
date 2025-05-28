from src.graph.instructions import TRANSFER_CHILDREN_INSTRUCTIONS, TRANSFER_PARENT_AWARE_INSTRUCTIONS, RAG_INSTRUCTIONS, ERROR_ESCALATION_AGENT_INSTRUCTIONS, TRANSFER_GIVE_UP_CONTROL_INSTRUCTIONS, SYSTEM_MESSAGE, CHILD_TRANSFER_RELATED_INSTRUCTIONS

def add_transfer_instructions_to_parent_agents(agent, children, transfer_functions):
    other_agent_name_descriptions_tools = f'\n{'-'*100}\n'.join([f"Name: {agent.name}\nDescription: {agent.description if agent.description else ''}\nTool for transfer: {transfer_functions[agent.name].__name__}" for agent in children.values()])
    
    prompt = TRANSFER_CHILDREN_INSTRUCTIONS.format(other_agent_name_descriptions_tools=other_agent_name_descriptions_tools)
    agent.instructions = agent.instructions + f'\n\n{'-'*100}\n\n' + prompt
    
    return agent

def add_transfer_instructions_to_child_agents(child, children_aware_of_parent):
    if children_aware_of_parent:
        candidate_parents_name_description_tools = f'\n{'-'*100}\n'.join([f"Name: {parent_name}\nTool for transfer: {func.__name__}" for parent_name, func in child.candidate_parent_functions.items()])
        prompt = TRANSFER_PARENT_AWARE_INSTRUCTIONS.format(candidate_parents_name_description_tools=candidate_parents_name_description_tools)
    else:
        candidate_parents_name_description_tools = f'\n{'-'*100}\n'.join(list(set([f"Tool for transfer: {func.__name__}" for _, func in child.candidate_parent_functions.items()])))
        prompt = TRANSFER_GIVE_UP_CONTROL_INSTRUCTIONS.format(candidate_parents_name_description_tools=candidate_parents_name_description_tools)
    
    child.instructions = child.instructions + f'\n\n{'-'*100}\n\n' + prompt
    return child

def add_rag_instructions_to_agent(agent_config, rag_tool_name):
    prompt = RAG_INSTRUCTIONS.format(rag_tool_name=rag_tool_name)
    agent_config["instructions"] = agent_config["instructions"] + f'\n\n{'-'*100}\n\n' + prompt
    return agent_config

def add_error_escalation_instructions(agent):
    prompt = ERROR_ESCALATION_AGENT_INSTRUCTIONS
    agent.instructions = agent.instructions + f'\n\n{'-'*100}\n\n' + prompt
    return agent

def get_universal_system_message(messages):
    if messages and messages[0].get("role") == "system":
        return SYSTEM_MESSAGE.format(system_message=messages[0].get("content"))
    return ""

def add_universal_system_message_to_agent(agent, universal_sys_msg):
    agent.instructions = agent.instructions + f'\n\n{'-'*100}\n\n' + universal_sys_msg
    return agent

def add_child_transfer_related_instructions(agent):
    prompt = CHILD_TRANSFER_RELATED_INSTRUCTIONS
    agent.instructions = agent.instructions + f'\n\n{'-'*100}\n\n' + prompt
    return agent
