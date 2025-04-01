# Welcome to Rowboat

Rowboat is an open-source Cursor like IDE that helps you build, test, and deploy multi-agent AI systems.

**Note:** These docs are intended for both developers who would like to self-host our [open-source code](https://github.com/rowboatlabs/rowboat/) as well as users of our [hosted (managed) app](https://app.rowboatlabs.com/).

- Our source code is on GitHub at [@rowboatlabs/rowboat](https://github.com/rowboatlabs/rowboat/)
- Join us on [discord](https://discord.gg/jHhUKkKHn8)
- Email us at [founders@rowboatlabs.com](mailto:founders@rowboatlabs.com)
- Visit our [website](https://www.rowboatlabs.com/)

## What is RowBoat?
**RowBoat is a state-of-art platform to build multi-agent AI systems in a visual interface, with the help of a copilot.**

RowBoat enables you to build, manage and deploy user-facing assistants. An assistant is made up of multiple agents, each having access to a set of tools and working together to interact with the user as a single assistant.

For example, you can build a *credit card assistant*, where each agent handles a workflow such as *outstanding payments*, *balance inquiries* and *transaction disputes*. You can equip agents with tools to carry out tasks such as *fetching payment options*, *checking outstanding balance* and *updating user information*. The assistant would help your end-users their credit card-related needs without having to talk to a human agent on your end.

## How RowBoat works

### RowBoat Studio
RowBoat Studio lets you create AI agents in minutes, using a visual interface and plain language. Here are key components that you will work with:

| Component  | Description | Highlights |
|------------|-------------|------------|
| Agent     | Handles a specific part of the conversation and<br>performs tasks using tools, based on instructions |• Configurable using plain language instructions<br>• Orchestrate between agents connected as a graph<br>• Can access tools and knowledge sources (RAG)|
| Playground | Interactive environment to test assistants<br>conversationally as you build them |• Real-time testing and debugging<br>• Inspect parameters and results of tool calls in-line<br>• Converse with individual agents or the entire assistant|
| Copilot    | AI-powered concierge that creates and<br>updates agents and tools on your behalf |• Context-aware of all components including playground<br>• Improves agents based on conversations and feedback <br>• Understands your requests in plain language|
| Simulator  | Simulates real-world user interactions<br>with your assistant |• Maintain and run a test-bench of different scenarios<br>• Mock tool responses for quick testing<br>• Reproduce your end-user's experience comprehensively|

### RowBoat Chat API & SDK
- RowBoat Chat API is a stateless HTTP API to interface with the assistant created on RowBoat Studio. You can use the API to drive end-user facing conversations in your app or website.
- RowBoat Chat SDK is a simple SDK (currently available in Python) which wraps the HTTP API under the hood. It offers both stateful and stateless (OpenAI-style) implementations.

### Steps
**RowBoat Studio:**

1. Describe the assistant you are looking to build, to **copilot**
2. Review and apply the **agents** (and tools) created by copilot
3. Configure **tools** by connecting them to your APIs
4. Chat with your assistant in the **playground**
5. Create and run a test-bench of scenarios in the **simulator**
6. Deploy the current version to production, with **version control**

**RowBoat SDK:**

1. **Integrate** the SDK into your end-user facing chat application. Use the latest deployed version of your assistant from RowBoat Studio, by specifying your RowBoat API key.
2. Alternatively, **export** your assistant as a JSON artifact from RowBoat Studio and use it to power your custom implementations.

## Why RowBoat?
Accelerate your path to production-ready multi-agent systems.

1. **Build** complex assistants using plain language and a visual interface
2. **Integrate** tools and MCP servers in minutes
3. **Expedite** your multi-agent AI roadmap using battle-tested tooling

## Getting started

- To set up our open-source installation, see [this guide](/installation)
- To sign up for our managed offering (beta), please email us at [founders@rowboatlabs.com](mailto:founders@rowboatlabs.com)