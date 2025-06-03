## Getting started

- ✨ **Start from an idea → Copilot builds your multi-agent workflows**  
  E.g. "Build me an assistant for a food delivery company to handle delivery status and missing items. Include the necessary tools."
- 🌐 **Connect MCP servers**  
  Add the MCP servers in Settings → import the tools into Rowboat.
- 📞 **Integrate into your app using the HTTP API or Python SDK**  
  Grab the Project ID and generated API Key from Settings and use the API.

Powered by OpenAI's Agents SDK, Rowboat is the fastest way to build multi-agents!

## Quick start

Step 1. Set your OpenAI key:

```bash
export OPENAI_API_KEY=your-openai-api-key
```
      
Step 2. Clone the repository and start Rowboat docker

```bash
git clone git@github.com:rowboatlabs/rowboat.git
cd rowboat
docker-compose up --build
```

Step 3. Access the app at [http://localhost:3000](http://localhost:3000).

Note: See the [Using custom LLM providers](#using-custom-llm-providers) section below for using custom providers like OpenRouter and LiteLLM.

## Demo

#### Create a multi-agent assistant with MCP tools by chatting with Rowboat
[![Screenshot 2025-04-23 at 00 25 31](https://github.com/user-attachments/assets/c8a41622-8e0e-459f-becb-767503489866)](https://youtu.be/YRTCw9UHRbU)

## Integrate with Rowboat agents

There are 2 ways to integrate with the agents you create in Rowboat

**Option #1: HTTP API**

You can use the API directly at [http://localhost:3000/api/v1/](http://localhost:3000/api/v1/). See [API Docs](https://docs.rowboatlabs.com/using_the_api/) for details.

```bash
curl --location 'http://localhost:3000/api/v1/<PROJECT_ID>/chat' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer <API_KEY>' \
--data '{
    "messages": [
        {
            "role": "user",
            "content": "tell me the weather in london in metric units"
        }
    ],
    "state": null
}'
```
   

**Option #2: Python SDK**
   
You can use the included Python SDK to interact with the Agents

```python
from rowboat import Client, StatefulChat
from rowboat.schema import UserMessage, SystemMessage

# Initialize the client
client = Client(
    host="http://localhost:3000",
    project_id="<PROJECT_ID>",
    api_key="<API_KEY>"
)

# Create a stateful chat session (recommended)
chat = StatefulChat(client)
response = chat.run("What's the weather in London?")
print(response)

# Or use the low-level client API
messages = [
    SystemMessage(role='system', content="You are a helpful assistant"),
    UserMessage(role='user', content="Hello, how are you?")
]

# Get response
response = client.chat(messages=messages)
print(response.messages[-1].content)
```

## Using custom LLM providers
By default, Rowboat uses OpenAI LLMs (gpt-4o, gpt-4.1, etc.) for both agents and copilot, when you export your OPENAI_API_KEY. 

However, you can also configure custom LLM providers (e.g. LiteLLM, OpenRouter) to use any of the hundreds of available LLMs beyond OpenAI, such as Claude, DeepSeek, Ollama LLMs and so on.

**Step 1:** Set up your custom LLM provider using the variables below, for example (assuming LiteLLM):

```bash
export PROVIDER_BASE_URL=http://host.docker.internal:4000/
export PROVIDER_API_KEY=sk-1234
```

Rowboat uses "gpt-4.1" as the default model for agents and copilot but this can be overridden as follows, for example (assuming LiteLLM):

```bash
export PROVIDER_DEFAULT_MODEL=claude-3-7-sonnet-latest
export PROVIDER_COPILOT_MODEL=gpt-4o
```

**Notes:**

- Copilot is optimized for gpt-4o/gpt-4.1. We strongly recommend using these models for best performance.
- You can specify different models for the copilot and each agent, but all of them must belong to the same provider (e.g. LiteLLM)
- The integration is provider-agnostic and should work with any service that implements the OpenAI messages format.
- OpenAI-specific tools (e.g., web_search) will not work with non-OpenAI providers. If you get an error, remove these tools.

**Step 2 (No change):** Clone the repository and start Rowboat docker

```bash
git clone git@github.com:rowboatlabs/rowboat.git
cd rowboat
docker-compose up --build
```

**Step 3 (No change):** Access the app at [http://localhost:3000](http://localhost:3000).

