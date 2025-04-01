# Agents

## Overview
- Agents carry out a specific part of the conversation and / or perform tasks like orchestrating between other agents, triggering internal processes and fetching information.
- Agents carry out tasks through tools provided to them.
- Agents can be connected to other agents through a mention in the agent's instruction.

## Agent Configurations

### Description
The description conveys the agent's role in the multi-agent system. Writing a good description is important for other agents to know when to pass control of the conversation to an agent.

### Instructions
Agent instructions are the backbone of an agent, defining its behavior. RowBoat Studio's copilot produces a good framework for agent instructions, involving Role, Steps to Follow, Scope and Guidelines. Since agents are powered by LLMs, general best practices while writing prompts apply.

### Examples
The agent uses examples as a reference for behavior in different scenarios. While there are no prescribed formats to provide examples in, examples should include what the user might say, what the agent should respond with as well as indications of any tool calls to be made.

### Prompts
Prompts attached to an agent will be used by the agent in addition to instructions.

### RAG
Data sources added to an agent will be used as knowledge, retrieved using embedding match in a typical RAG fashion. Advanced configurations allow for setting number of matches, etc. RAG is currently implemented as a predefined tool call which the agent will use when it determines that it needs to retrieve knowledge. This behavior can be further fine-tuned by specifying corresponding instructions or prompts.

### Tools
Tools attached to an agent will be put out as tool calls. The behavior of when to invoke tools can be fine-tuned by specifying corresponding instructions or prompts. Adding examples to agents can also be useful in controlling tool call behavior.

### Connected Agents
In the agent graph, connected agents refer to children of an agent. An agent can choose to transfer control of the conversation to one of its children, by using internal tool calls (need not be configured separately). Similar to tools, the behavior of when to transfer the chat to a child agent can be fine-tuned by specifying corresponding instructions, examples and prompts.

### Model
RowBoat currently supports OpenAI LLMs. Agents can be configured to use any of the OpenAI LLMs.

### Conversation control after turn
This setting specifies different options for control of conversation after the current agent has put out a user-facing response (i.e., completed the turn). Currently available options are:

1. Retain control for the next turn of conversation (most common and default setting)
2. Give up control to the parent agent (used when the agent has narrow scope such as answering a FAQ)
3. Give up control to the agent designated as Start agent