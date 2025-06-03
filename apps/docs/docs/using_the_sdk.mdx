# Using the Python SDK

This is a guide on using the RowBoat Python SDK as an alternative to the [RowBoat HTTP API](/using_the_api) to power conversations with the assistant created in Studio.

## Prerequisites
- ``` pip install rowboat ```
- [Deploy your assistant to production](/using_the_api/#deploy-your-assistant-to-production-on-studio)
- [Obtain your `<API_KEY>` and `<PROJECT_ID>`](/using_the_api/#obtain-api-key-and-project-id)

### API Host
- For the open source installation, the `<HOST>` is [http://localhost:3000](http://localhost:3000)
- When using the hosted app, the `<HOST>` is [https://app.rowboatlabs.com](https://app.rowboatlabs.com)

## Usage

### Basic Usage with StatefulChat

The easiest way to interact with Rowboat is using the `StatefulChat` class, which maintains conversation state automatically:

```python
from rowboat import Client, StatefulChat

# Initialize the client
client = Client(
    host="<HOST>",
    project_id="<PROJECT_ID>",
    api_key="<API_KEY>"
)

# Create a stateful chat session
chat = StatefulChat(client)

# Have a conversation
response = chat.run("What is the capital of France?")
print(response)
# The capital of France is Paris.

# Continue the conversation - the context is maintained automatically
response = chat.run("What other major cities are in that country?")
print(response)
# Other major cities in France include Lyon, Marseille, Toulouse, and Nice.

response = chat.run("What's the population of the first city you mentioned?")
print(response)
# Lyon has a population of approximately 513,000 in the city proper.
```

### Advanced Usage

#### Using a specific workflow

You can specify a workflow ID to use a particular conversation configuration:

```python
chat = StatefulChat(
    client,
    workflow_id="<WORKFLOW_ID>"
)
```

#### Using a test profile

You can specify a test profile ID to use a specific test configuration:

```python
chat = StatefulChat(
    client,
    test_profile_id="<TEST_PROFILE_ID>"
)
```

### Low-Level Usage

For more control over the conversation, you can use the `Client` class directly:

```python
from rowboat.schema import UserMessage

# Initialize the client
client = Client(
    host="<HOST>",
    project_id="<PROJECT_ID>",
    api_key="<API_KEY>"
)

# Create messages
messages = [
    UserMessage(role='user', content="Hello, how are you?")
]

# Get response
response = client.chat(messages=messages)
print(response.messages[-1].content)

# For subsequent messages, you need to manage the message history and state manually
messages.extend(response.messages)
messages.append(UserMessage(role='user', content="What's your name?"))
response = client.chat(messages=messages, state=response.state)
```