# Rowboat Python SDK

A Python SDK for interacting with the Rowboat API.

## Installation

You can install the package using pip:

```bash
pip install rowboat
```

## Usage

### Basic Usage

Initialize a client and use the chat method directly:

```python
from rowboat import Client
from rowboat.schema import UserMessage, SystemMessage

# Initialize the client
client = Client(
    host="<HOST>",
    project_id="<PROJECT_ID>",
    api_key="<API_KEY>"
)

# Create messages
messages = [
    SystemMessage(role='system', content="You are a helpful assistant"),
    UserMessage(role='user', content="Hello, how are you?")
]

# Get response
response_messages, state = client.chat(messages=messages)
print(response_messages[-1].content)

# For subsequent messages, include previous messages and state
messages.extend(response_messages)
messages.append(UserMessage(role='user', content="What's your name?"))
response_messages, state = client.chat(messages=messages, state=state)
```

### Using Tools

The SDK supports function calling through tools:

```python
def weather_lookup(city_name: str) -> str:
    return f"The weather in {city_name} is 22°C."

# Create a tools dictionary
tools = {
    'weather_lookup': weather_lookup
}

# Use tools with the chat method
response_messages, state = client.chat(
    messages=messages,
    tools=tools
)
```

### Stateful Chat (Convenience Wrapper)

For simpler use cases, the SDK provides a `StatefulChat` class that maintains conversation state automatically:

```python
from rowboat import StatefulChat

# Initialize stateful chat
chat = StatefulChat(
    client,
    tools=tools,
    system_prompt="You are a helpful assistant."
)

# Simply send messages and get responses
response = chat.run("Hello, how are you?")
print(response)
# I'm good, thanks! How can I help you today?
```

### Advanced Usage

#### Using a specific workflow

```python
response_messages, state = client.chat(
    messages=messages,
    workflow_id="<WORKFLOW_ID>"
)

# or

chat = StatefulChat(
    client,
    workflow_id="<WORKFLOW_ID>"
)
```

#### Using a test profile
You can specify a test profile ID to use a specific test configuration:

```python
response_messages, state = client.chat(
    messages=messages,
    test_profile_id="<TEST_PROFILE_ID>"
)

# or

chat = StatefulChat(
    client,
    test_profile_id="<TEST_PROFILE_ID>"
)
```

#### Skip tool call runs
This will surface the tool calls to the SDK instead of running them automatically on the Rowboat server.

```python
response_messages, state = client.chat(
    messages=messages,
    skip_tool_calls=True
)

# or

chat = StatefulChat(
    client,
    skip_tool_calls=True
)
```
