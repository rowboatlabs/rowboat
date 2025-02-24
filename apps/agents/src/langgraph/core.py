from typing import Dict, List, Tuple, Any
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, FunctionMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import JsonOutputParser
from langchain_openai import ChatOpenAI
from langgraph.graph import Graph, MessageGraph, END
from langgraph.prebuilt import ToolInvocation
from langchain.tools import StructuredTool

import json

from ..graph.types import Agent, Response, ExecutionEngine
from ..graph.helpers.state import construct_state_from_response
from ..utils.common import common_logger as logger

def router(state):
    if state["next_agent"]:
        return state["next_agent"].name
    return END

def convert_to_lc_message_bck(msg):
    print(msg)
    lc_message = None
    if msg["role"] == "system":
        lc_message = SystemMessage(content=msg["content"])
    elif msg["role"] == "assistant":
        if msg.get("content"):
            lc_message = AIMessage(content=msg["content"])
        else:
            lc_message = AIMessage(content=msg["tool_calls"])
    elif msg["role"] == "user":
        lc_message = HumanMessage(content=msg["content"])
    elif msg["role"] == "function":
        lc_message = FunctionMessage(
            content=msg["content"],
            name=msg.get("name", "")
        )
    return lc_message

from langchain.schema import BaseMessage, HumanMessage, AIMessage, SystemMessage, FunctionMessage
try:
    from langchain.schema import ToolMessage  # Newer LangChain versions have ToolMessage for tool outputs
except ImportError:
    ToolMessage = None

try:
    from langchain_core.messages.utils import get_message_from_dict
except ImportError:
    from langchain_core.messages.utils import _message_from_dict as get_message_from_dict

from langchain.schema import HumanMessage, AIMessage, SystemMessage, FunctionMessage

try:
    from langchain_core.messages.utils import get_message_from_dict
except ImportError:
    from langchain_core.messages.utils import _message_from_dict as get_message_from_dict


def role_to_type(role: str) -> str:
    mapping = {
        "user": "human",
        "assistant": "ai",
        "system": "system",
        "function": "function",
        "tool": "function"  # Treat tool messages as function messages.
    }
    return mapping.get(role, role)

import json
from langchain.schema import HumanMessage, AIMessage, SystemMessage, FunctionMessage, BaseMessage

def convert_to_lc_message(message):
    """
    Converts a message (or list of messages) into a LangChain message object.
    
    This version:
      • Infers the role from "role" or (if missing) from "sender"
      • Directly instantiates the corresponding LangChain message class
      • Flattens any nested tool call information (removing nested "function" keys)
      • Updates the message’s additional_kwargs with extra metadata (excluding keys that might trigger conversion issues)
    """
    # If message is a list, process each element.
    if isinstance(message, list):
        return [convert_to_lc_message(m) for m in message]
    
    # If already a LangChain message, return it.
    if isinstance(message, BaseMessage):
        return message
    
    if not isinstance(message, dict):
        raise ValueError(f"Message must be a dict or a LangChain message, got: {type(message)}")
    
    # --- Infer role ---
    role = message.get("role")
    if not role:
        sender = str(message.get("sender", "")).lower()
        if sender in ("user", "human"):
            role = "user"
        elif sender in ("assistant", "agent", "ai"):
            role = "assistant"
        elif sender == "system":
            role = "system"
        elif sender or message.get("tool_name"):
            role = "function"  # Treat tool messages as function messages.
        else:
            role = "assistant"
    
    # --- Get content ---
    content = message.get("content") or ""
    
    # --- Prepare additional metadata ---
    # Exclude keys that are explicitly handled.
    additional_kwargs = {}
    for key, value in message.items():
        if key in ("role", "sender", "content", "name", "tool_name", "tool_call_id", "tool_calls", "type"):
            continue
        additional_kwargs[key] = value

    # Process any tool_calls: flatten nested "function" entries.
    if "tool_calls" in message:
        tool_calls = message["tool_calls"]
        new_tool_calls = []
        if isinstance(tool_calls, list):
            for tc in tool_calls:
                if isinstance(tc, dict) and "function" in tc:
                    try:
                        arguments_str = tc["function"].get("arguments", "{}")
                        args = json.loads(arguments_str)
                    except Exception:
                        args = {}
                    new_tc = {
                        "name": tc["function"].get("name", ""),
                        "args": args,
                        "id": tc.get("id"),
                        "type": tc.get("type", "function")
                    }
                    new_tool_calls.append(new_tc)
                elif isinstance(tc, dict):
                    tc.pop("function", None)
                    new_tool_calls.append(tc)
                else:
                    new_tool_calls.append(tc)
        else:
            new_tool_calls = tool_calls
        additional_kwargs["tool_calls"] = new_tool_calls

    if "tool_call_id" in message:
        additional_kwargs["tool_call_id"] = message["tool_call_id"]
    
    # --- Build the LangChain message object directly ---
    if role in ("user", "human"):
        msg = HumanMessage(content=content)
    elif role in ("assistant", "agent", "ai"):
        msg = AIMessage(content=content)
    elif role == "system":
        msg = SystemMessage(content=content)
    elif role in ("function", "tool"):
        # For function/tool messages, we require a name.
        fn_name = message.get("name") or message.get("tool_name")
        if not fn_name:
            raise ValueError(f"Function/tool message missing required field 'name': {message}")
        msg = FunctionMessage(content=content, name=fn_name)
    else:
        # Fallback to AIMessage.
        msg = AIMessage(content=content)
    
    # --- Update additional metadata (without clashing with internal keys) ---
    msg.additional_kwargs.update(additional_kwargs)
    return msg

def create_agent_node(agent: Agent):
    """Creates a LangGraph node for an agent"""

    # Create the chat model
    model = ChatOpenAI(
        model=agent.model,
        temperature=0
    )

    # Create the prompt template
    prompt = ChatPromptTemplate.from_messages([
        ("system", agent.instructions),
        #MessagesPlaceholder(variable_name="history"),
        #MessagesPlaceholder(variable_name="messages")
    ])

    # Create the function calling config
    def convert_to_tool(fn):
        """Convert a raw function to a LangChain StructuredTool if needed."""
        if isinstance(fn, dict) and "function" in fn:  # Already a structured tool dict
            return fn
        if callable(fn):  # Convert raw function to StructuredTool
            return StructuredTool.from_function(fn)
        raise ValueError(f"Invalid tool format: {fn}")

    tools = []
    if agent.external_tools:
        tools.extend(convert_to_tool(t) for t in agent.external_tools)
    if agent.internal_tools:
        tools.extend(convert_to_tool(t) for t in agent.internal_tools)
    if agent.child_functions:
        tools.extend(convert_to_tool(fn) for fn in agent.child_functions.values())
    if agent.parent_function:
        tools.append(convert_to_tool(agent.parent_function))

    def agent_node(state):
        print("OIULKJLOIUOLOIUOI:LKJ agent node")
        # Get messages from state
        messages = state.get("messages", [])
        history = state.get("history", [])

        # Convert messages to LangChain format
        lc_history = [convert_to_lc_message(msg) for msg in history]
        lc_messages = [convert_to_lc_message(msg) for msg in messages]
        formatted_messages = prompt #.format_messages(history=lc_history, messages=lc_messages)

        print("FORMATTED MESSAGES")
        response = model.invoke(formatted_messages, tools=tools)

        print("INVOKED MODEL")
        # Handle tool calls if present
        if hasattr(response, "tool_calls") and response.tool_calls:
            print("TOOL CALLS PRESENT")
            tool_calls = response.tool_calls
            results = []
            function_messages = []

            # Collect transfer tool names
            transfer_tool_names = [fn.__name__ for fn in agent.child_functions.values()] + ([agent.parent_function.__name__] if agent.parent_function else [])

            for tool_call in tool_calls:
                tool_name = tool_call.function.name
                args = json.loads(tool_call.function.arguments)
                
                if tool_name in transfer_tool_names:
                    if tool_name == "transfer_to_parent" and agent.most_recent_parent:
                        next_agent = agent.most_recent_parent
                        function_messages.append(FunctionMessage(
                            name=tool_name,
                            content=f"Transferred to parent agent: {agent.most_recent_parent.name}"
                        ))
                    elif tool_name.startswith("transfer_to_"):
                        child_name = tool_name[len("transfer_to_"):]
                        if child_name in agent.children:
                            next_agent = agent.children[child_name]
                            function_messages.append(FunctionMessage(
                                name=tool_name,
                                content=f"Transferred to child agent: {child_name}"
                            ))
                        else:
                            function_messages.append(FunctionMessage(
                                name=tool_name,
                                content=f"Error: Child agent {child_name} not found"
                            ))
                    else:
                        function_messages.append(FunctionMessage(
                            name=tool_name,
                            content=f"Error: Invalid transfer tool {tool_name}"
                        ))
                else:
                    try:
                        tool = next(t for t in tools if t["function"]["name"] == tool_name)
                        result = tool["function"]["function"](**args)
                        function_messages.append(FunctionMessage(
                            name=tool_name,
                            content=str(result)
                        ))
                    except Exception as e:
                        function_messages.append(FunctionMessage(
                            name=tool_name,
                            content=f"Error executing tool {tool_name}: {str(e)}"
                        ))
            
            final_messages = messages + [response] + function_messages
            print(f"Returning messages with tool calls: {[str(m) for m in final_messages]}")
            return {
                "messages": final_messages,
                "current_agent": agent,
                "next_agent": next_agent
            }

        # No tool calls - conversation complete
        return {
            "messages": messages + [response],
            "current_agent": agent,
            "next_agent": None
        }

    return agent_node

def create_graph(agents: List[Agent], start_agent: Agent) -> Graph:
    """Creates the LangGraph execution graph"""
    print("KLJLKJLKJ:LKJ:LKJ Creating LangGraph execution graph")

    # Create nodes for each agent
    nodes = {
        agent.name: create_agent_node(agent)
        for agent in agents
    }

    print("CREATED NODES")
    # Create the graph
    workflow = MessageGraph()

    
    # Add nodes
    for name, node in nodes.items():
        workflow.add_node(name, node)

    print("ADDED NODES to WORKFLOW")
    # Add edges based on agent relationships
    for agent in agents:
        # Add edges to children
        for child_name in agent.children:
            workflow.add_edge(agent.name, child_name)

        # Add edge to parent if exists
        if agent.most_recent_parent:
            workflow.add_edge(agent.name, agent.most_recent_parent.name)

    print("ADDED EDGES to WORKFLOW")
    # Set entry point
    workflow.set_entry_point(start_agent.name)

    print("SET ENTRY POINT to WORKFLOW")

    # Set conditional edges
    def router(state):
        if state["next_agent"]:
            return state["next_agent"].name
        return None

    for agent in agents:
        workflow.add_conditional_edges(
            agent.name,  # source node
            router       # condition function
        )
    print("ADDED CONDITIONAL EDGES to WORKFLOW")
    z = workflow.compile()
    print("COMPILED WORKFLOW")
    print(workflow)
    return z

def run_langgraph(
    messages: List[Dict],
    start_agent: Agent,
    all_agents: List[Agent],
    tokens_used: Dict = None,
    **kwargs
) -> Tuple[List[Dict], Dict, Dict]:
    """Runs the LangGraph execution"""

    # Create the graph with all agents and the starting agent
    graph = create_graph(all_agents, start_agent)

    print("CREATED GRAPH")
    # Prepare the initial state
    lc_messages = [convert_to_lc_message(msg) for msg in messages]
    state = {
        "messages": lc_messages,
        "history": [],
        "current_agent": start_agent,
        "next_agent": start_agent
    }

    print("Initial messages:")
    print(lc_messages)
    for msg in lc_messages:
        print(msg)
    print(graph)
    print("PREPARED STATE")
    # Execute the graph using invoke instead of run
    final_state = graph.invoke(state)
    print("INVOKED GRAPH")

    # Construct the response from the final state
    response = Response(
        messages=final_state["messages"],
        agent=final_state["current_agent"],
        context_variables={},
        error_msg="",
        tokens_used=tokens_used or {}
    )

    # Update the state based on the response
    new_state = construct_state_from_response(response, all_agents)

    # Return the messages, tokens used, and new state
    return response.messages, response.tokens_used, new_state
