# Graph-based Framework

## Overview

- Multi-agent systems are popularly represented as graphs, where each agent is a node in the graph.  
- In RowBoat, agents are connected to each other as Directed Acyclic Graphs (DAG).
- The graph is also called a workflow, which defines agents, tools, and their connections.
- Since the graph is directed, the control of conversation flows from "parent" agents to their "children" agents
- Every agent is responsible for carrying out a specific part of the workflow, which can involve conversing with the user and / or carrying out tasks such as directing the conversation to other agents.
- [Langgraph](https://www.langchain.com/langgraph) and [Swarm](https://github.com/openai/swarm) are examples of open-source frameworks used to define multi-agent graphs. RowBoat currently supports a Swarm implementation and will extend to Langgraph too in the future.

## Control Passing

- While defining the workflow, an agent is designated as the Start agent, to which the first turn of chat will be directed. Typically the Start agent is responsible for triaging the user's query at a high-level and passing control to relevant specific agents which can address the user's needs.
- In any turn of chat, the agent currently in control of the chat has one of 3 options: a) respond to the user (or put out tool calls), b) transfer the chat to any of its children agents or c) transfer the chat back to its parent agent.
- Agents use internal tool calls to transfer the chat to other agents.
- Thus, control passing is achieved by allowing agents to decide flow of control autonomously.
- To the user, the assistant will appear as a unified system, while agents work under the hood.

## Pipelines

- RowBoat also has the concept of pipelines - specialized agents invoked sequentially after an agent in the graph has produced a user-facing response. 
- E.g. a pipeline with a post processing agent and a guardrail agent will ensure that every response is post processed and guardrailed for appropriateness before presenting it to the user.
