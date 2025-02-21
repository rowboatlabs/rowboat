from typing import Dict, List, Tuple, Any
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, FunctionMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import JsonOutputParser
from langchain_openai import ChatOpenAI
from langgraph.graph import Graph, MessageGraph, END
from langgraph.prebuilt import ToolInvocation

import json

from ..graph.types import Agent, Response, ExecutionEngine
from ..graph.helpers.state import construct_state_from_response
from ..utils.common import common_logger as logger

def router(state):
    if state["next_agent"]:
        return state["next_agent"].name
    return END

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
        MessagesPlaceholder(variable_name="history"),
        MessagesPlaceholder(variable_name="messages")
    ])

    # Create the function calling config
    tools = []
    if agent.external_tools:
        tools.extend(agent.external_tools)
    if agent.internal_tools:
        tools.extend(agent.internal_tools)
    if agent.child_functions:
        tools.extend([fn for fn in agent.child_functions.values()])
    if agent.parent_function:
        tools.append(agent.parent_function)

    def agent_node(state):
        print("OIULKJLOIUOLOIUOI:LKJ agent node")
        # Get messages from state
        messages = state.get("messages", [])
        history = state.get("history", [])

        # Convert messages to LangChain format
        lc_messages = []
        for msg in history + messages:
            if msg["role"] == "system":
                lc_messages.append(SystemMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                lc_messages.append(AIMessage(content=msg["content"]))
            elif msg["role"] == "user":
                lc_messages.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "function":
                lc_messages.append(FunctionMessage(
                    content=msg["content"],
                    name=msg.get("name", "")
                ))

        # Get response from model
        response = model.invoke(
            prompt.format(
                history=history,
                messages=messages
            ),
            tools=tools
        )

        # Handle tool calls if present
        if hasattr(response, "tool_calls") and response.tool_calls:
            tool_calls = response.tool_calls
            results = []

            # Collect transfer tool names
            transfer_tool_names = [fn.__name__ for fn in agent.child_functions.values()] + ([agent.parent_function.__name__] if agent.parent_function else [])

            for tool_call in tool_calls:
                tool_name = tool_call.function.name
                args = json.loads(tool_call.function.arguments)

                if tool_name in transfer_tool_names:
                    if tool_name == "transfer_to_parent" and agent.most_recent_parent:
                        results.append({
                            "type": "agent_transfer",
                            "agent": agent.most_recent_parent,
                            "content": args
                        })
                    elif tool_name.startswith("transfer_to_"):
                        child_name = tool_name[len("transfer_to_"):]
                        if child_name in agent.children:
                            child_agent = agent.children[child_name]
                            results.append({
                                "type": "agent_transfer",
                                "agent": child_agent,
                                "content": args
                            })
                        else:
                            results.append({
                                "type": "tool_result",
                                "tool": tool_name,
                                "content": f"Error: Child agent {child_name} not found"
                            })
                    else:
                        results.append({
                            "type": "tool_result",
                            "tool": tool_name,
                            "content": f"Error: Invalid transfer tool {tool_name}"
                        })
                else:
                    # Handle regular tool call
                    try:
                        tool = next(t for t in tools if t["function"]["name"] == tool_name)
                        result = tool["function"]["function"](**args)
                        results.append({
                            "type": "tool_result",
                            "tool": tool_name,
                            "content": result
                        })
                    except Exception as e:
                        results.append({
                            "type": "tool_result",
                            "tool": tool_name,
                            "content": f"Error executing tool {tool_name}: {str(e)}"
                        })

            next_agent = None
            for result in results:
                if result["type"] == "agent_transfer":
                    next_agent = result["agent"]
                    break
            if not next_agent:
                next_agent = agent

            return {
                "messages": messages + [response] + results,
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

    # Create the graph
    workflow = MessageGraph()

    # Add nodes
    for name, node in nodes.items():
        workflow.add_node(name, node)

    # Add edges based on agent relationships
    for agent in agents:
        # Add edges to children
        for child_name in agent.children:
            workflow.add_edge(agent.name, child_name)

        # Add edge to parent if exists
        if agent.most_recent_parent:
            workflow.add_edge(agent.name, agent.most_recent_parent.name)

    # Set entry point
    workflow.set_entry_point(start_agent.name)

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
    return workflow.compile()

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

    # Prepare the initial state
    state = {
        "messages": messages,
        "history": [],
        "current_agent": start_agent,
        "next_agent": start_agent
    }

    # Execute the graph using invoke instead of run
    final_state = graph.invoke(state)

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
