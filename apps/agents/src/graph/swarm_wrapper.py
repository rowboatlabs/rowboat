from src.swarm.core import Swarm
from src.swarm.types import Agent as SwarmAgent, Response as SwarmResponse
import logging
import json

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

from agents import Agent as NewAgent, Runner, FunctionTool, function_tool
# Add import for OpenAI functionality
from src.utils.common import generate_openai_output

# Create a dedicated logger for swarm wrapper
logger = logging.getLogger("swarm_wrapper")
logger.setLevel(logging.INFO)

# Re-export the types from src.swarm.types
Agent = SwarmAgent
Response = SwarmResponse


def create_python_tool(tool_name, tool_description, tool_params):
    """
    Return a Python function definition (as a string) with the given name, docstring,
    and parameters derived from a JSON-schema-like dictionary.

    :param tool_name: str
        Name of the function to generate.
    :param tool_description: str
        High-level docstring/description for the function.
    :param tool_params: dict
        A JSON Schema–style definition with 'parameters':
          {
            "parameters": {
              "type": "object",
              "properties": {
                "<param_name>": {
                  "type": "string" | "integer" | "number" | "boolean" | "object" | "array",
                  "description": "..."
                },
                ...
              }
            }
          }
    :return: str
        The function definition as a string (no shebang or `if __name__ == "__main__"`).
    """

    # Maps JSON Schema types to Python type hints
    type_map = {
        "string": "str",
        "integer": "int",
        "number": "float",
        "boolean": "bool",
        "object": "dict",
        "array": "list",
    }

    # Extract the properties from the JSON-schema-like dict
    properties = tool_params.get("parameters", {}).get("properties", {})

    # Build the function signature and docstring pieces
    signature_parts = []
    docstring_params = []
    for param_name, param_info in properties.items():
        # Default to "str" if no specific type is given
        json_type = param_info.get("type", "string")
        python_type = type_map.get(json_type, "str")
        description = param_info.get("description", "")

        # e.g. "orderId: str"
        signature_parts.append(f"{param_name}: {python_type}")

        # Build docstring lines (reST style)
        docstring_params.append(f":param {param_name}: {description}")
        docstring_params.append(f":type {param_name}: {python_type}")

    signature = ", ".join(signature_parts)
    params_docstring_text = "\n    ".join(docstring_params)

    function_docstring = f'''\"\"\"{tool_description}

    {params_docstring_text}
\"\"\"'''

    # Return only the function definition (no shebang or main guard)
    # Return the function definition including the @function_tool decorator
    function_code = f'''@function_tool
async def {tool_name}({signature}):
    {function_docstring}
    # TODO: Implement your logic here
    messages = [
        {{"role": "system", "content": f"You are simulating the execution of a tool called '{tool_name}'. The tool has this description: {tool_description}. Generate a realistic response as if the tool was actually executed with the given parameters."}},
        {{"role": "user", "content": f"Generate a realistic response for the tool '{tool_name}'. The response should be concise and focused on what the tool would actually return."}}
    ]
    response_content = generate_openai_output(messages, output_type='text', model="gpt-4o")

    return(response_content)
'''
    return function_code


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
    new_agents = []
    new_agent_to_children = {}
    new_agent_name_to_index = {}
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
        candidate_parent_functions = {}
        child_functions = {}

        logger.debug(f"Agent {agent_config['name']} has {len(agent_config['tools'])} configured tools")

        new_tools = []
        for tool_name in agent_config["tools"]:
            tool_config = get_tool_config_by_name(tool_configs, tool_name)
            if tool_config:
                external_tools.append({
                    "type": "function",
                    "function": tool_config
                })

                # Create a dummy function to mock the tool execution
                # Use a closure to capture the tool_name variable properly
                def create_mock_tool_function(tool_name):

                    @function_tool(
                        name=tool_name,
                        description=tool_config.get("description", ""),
                        params_json_schema=tool_config.get("parameters", {})
                    )
                    def mock_tool_execution(**kwargs):
                        # Docstring will be set after function definition
                        logger.info(f"Executing tool {tool_name} with params: {kwargs}")

                        # Create a prompt for OpenAI to generate a realistic response
                        messages = [
                            {"role": "system", "content": f"You are simulating the execution of a tool called '{tool_name}'. The tool has this description: {tool_config.get('description', 'No description available')}. Generate a realistic response as if the tool was actually executed with the given parameters."},
                            {"role": "user", "content": f"Generate a realistic response for the tool '{tool_name}' with these parameters: {json.dumps(kwargs)}. The response should be concise and focused on what the tool would actually return."}
                        ]

                        try:
                            # Call OpenAI to generate a realistic response
                            response_content = generate_openai_output(messages, output_type='text', model="gpt-4o")

                            # Return a properly structured response with the OpenAI-generated content
                            return {
                                "status": "success",
                                "tool": tool_name,
                                "result": response_content,
                                "params_received": kwargs
                            }
                        except Exception as e:
                            logger.error(f"Error generating mock response for {tool_name}: {str(e)}")
                            # Fall back to a simple mock response if OpenAI call fails
                            return {
                                "status": "success",
                                "tool": tool_name,
                                "result": f"Simulated result for {tool_name}",
                                "params_received": kwargs,
                                "error": str(e)
                            }


                    # Set the docstring to use the tool's description
                    mock_tool_execution.__doc__ = tool_config.get("description", "Mock function that simulates tool execution")
                    return mock_tool_execution
                tool_code = create_python_tool(tool_name, tool_config.get("description", ""), tool_config.get("parameters", {}))
                local_namespace = {"function_tool": function_tool, "generate_openai_output": generate_openai_output}

# Execute the generated code so `my_tool` is defined in local_namespace
                exec(tool_code, local_namespace)
                print(tool_code)
                my_tool_func = local_namespace[tool_name]
                new_tools.append(my_tool_func)
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
                internal_tools=[],
                external_tools=external_tools,
                candidate_parent_functions=candidate_parent_functions,
                child_functions=child_functions,
                model=agent_config["model"],
                respond_to_user=agent_config.get("respond_to_user", False),
                history=history,
                children_names=agent_config.get("connectedAgents", []),
                most_recent_parent=None
            )
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

    # Finally add a universal system message to all agents
    for agent in agents:
        add_universal_system_message_to_agent(agent, universal_sys_msg)

    for new_agent in new_agents:
        # Initialize the handoffs attribute if it doesn't exist
        if not hasattr(new_agent, 'handoffs'):
            new_agent.handoffs = []
        # Look up the agent's children from the old agent and create a list called handoffs in new_agent with pointers to the children in new_agents
        new_agent.handoffs = [new_agents[new_agent_name_to_index[child]] for child in new_agent_to_children[new_agent.name]]

    return agents, new_agents


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
    response2 = Runner.run_sync(agent, formatted_messages)

    logger.info(f"Completed Swarm run for agent: {agent.name}")
    return response2