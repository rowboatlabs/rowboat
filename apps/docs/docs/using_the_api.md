# Using the API

This is a guide on using the HTTP API to power conversations with the assistant created in Studio.

## Deploy your assistant to production on Studio

![Prod Deploy](img/prod-deploy.png)

## Obtain API key and Project ID

Generate API keys via the developer configs in your project. Copy the Project ID from the same page.
![Developer Configs](img/dev-config.png)

## API Endpoint

```
POST <HOST>/api/v1/<PROJECT_ID>/chat
```

Where:

-   For self-hosted: `<HOST>` is `http://localhost:3000`

## Authentication

Include your API key in the Authorization header:

```
Authorization: Bearer <API_KEY>
```

## Examples

### First Turn

```bash
curl --location '<HOST>/api/v1/<PROJECT_ID>/chat' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer <API_KEY>' \
--data '{
    "messages": [
        {
            "role": "user",
            "content": "Hello, can you help me?"
        }
    ],
    "state": null
}'
```

Response:

```json
{
    "conversationId": "68adc1bdecaccc24596913d9",
    "turn": {
        "reason": { "type": "api" },
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": "Hello, can you help me?",
                    "timestamp": "2025-08-26T14:16:29.031Z"
                }
            ]
        },
        "output": [
            {
                "role": "assistant",
                "content": "Of course! What would you like to work with today: Presentations, Jira Tickets, or Meeting Notes?",
                "agentName": "Hub Agent",
                "responseType": "external",
                "timestamp": "2025-08-26T14:16:29.851Z"
            }
        ],
        "id": "NHhOPXbf-QyQoPhRg7lci",
        "createdAt": "2025-08-26T14:16:29.851Z"
    }
}
```

### Subsequent Turn

Notice how we now include the conversationId of the previous response.
It is not needed to provide the full conversation history. Rowboat automatically persists the full conversation and state in the mongoDB.

```bash
curl --location '<HOST>/api/v1/<PROJECT_ID>/chat' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer <API_KEY>' \
--data '{
    "messages": [
        {
            "role": "user",
            "content": "Before moving on, tell me a joke about fear of presentations"
        }
    ], 
    "conversationId":"68adc1bdecaccc24596913d9"
}'

```

Response:

```json
{
    "conversationId": "68adc1bdecaccc24596913d9",
    "turn": {
        "reason": { "type": "api" },
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": "Before moving on, tell me a joke about fear of presentations",
                    "timestamp": "2025-08-26T14:30:42.391Z"
                }
            ]
        },
        "output": [
            {
                "role": "assistant",
                "content": "Why did the nervous presenter bring a pencil to the podium?\n\nIn case they needed to draw a blank!",
                "agentName": "Hub Agent",
                "responseType": "external",
                "timestamp": "2025-08-26T14:30:43.603Z"
            }
        ],
        "id": "rU4cVmURrOSp2rg-g1RCR",
        "createdAt": "2025-08-26T14:30:43.603Z"
    }
}

```

### Advanced tool call response

```json
{
    "conversationId": "68adc1bdecaccc24596913d9",
    "turn": {
        "reason": { "type": "api" },
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": "I want to work with meeting notes. Can you show the different meeting notes available?",
                    "timestamp": "2025-08-26T14:23:01.800Z"
                }
            ]
        },
        "output": [
            {
                "role": "assistant",
                "content": null,
                "toolCalls": [
                    {
                        "id": "37a47d44-14a8-41cb-9650-7e5a08f8a270",
                        "type": "function",
                        "function": {
                            "name": "transfer_to_agent",
                            "arguments": "{\"assistant\":\"Meeting Notes Assistant\"}"
                        }
                    }
                ],
                "agentName": "Hub Agent",
                "timestamp": "2025-08-26T14:23:02.939Z"
            },
            {
                "role": "tool",
                "content": "{\"assistant\":\"Meeting Notes Assistant\"}",
                "toolCallId": "37a47d44-14a8-41cb-9650-7e5a08f8a270",
                "toolName": "transfer_to_agent",
                "timestamp": "2025-08-26T14:23:02.939Z"
            },
            {
                "role": "assistant",
                "content": null,
                "toolCalls": [
                    {
                        "id": "call_ObcAvf3wbKaoWgsyLgzKI9w0",
                        "type": "function",
                        "function": {
                            "name": "list_meeting_notes",
                            "arguments": "{}"
                        }
                    }
                ],
                "agentName": "Meeting Notes Assistant",
                "timestamp": "2025-08-26T14:23:04.102Z"
            },
            {
                "role": "tool",
                "content": "{\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"01. Sample meeting noteA 02. Sample meeting noteB\"}]}}",
                "toolCallId": "call_ObcAvf3wbKaoWgsyLgzKI9w0",
                "toolName": "list_meeting_notes",
                "timestamp": "2025-08-26T14:23:05.047Z"
            },
            {
                "role": "assistant",
                "content": "Here are some of the available meeting notes:\n\n 01. Sample meeting noteA \n 02. Sample meeting noteB ",
                "agentName": "Meeting Notes Assistant",
                "responseType": "external",
                "timestamp": "2025-08-26T14:23:22.356Z"
            }
        ],
        "id": "5qZnTgTtSW9SAtdFGuthj",
        "createdAt": "2025-08-26T14:23:22.359Z"
    }
}
```

## API Specification

### Request Schema

```typescript
{
    // Required fields
    messages: Message[];      // Array of message objects representing new incoming messages

    // Optional fields
    conversationId?: string;     // Conversation ID to continue an existing conversation
    mockTools?: Record<string, string>;  // Mock tool responses for testing
}
```

You can provide tool override instructions to test a specific configuration using the `mockTools` argument:

```json
{
    "weather_lookup": "The weather in any city is sunny and 25°C.",
    "calculator": "The result of any calculation is 42."
}
```

### Message Types

Messages can be one of the following types:

#### System Message

```typescript
{
    role: "system";
    content: string;
}
```

#### User Message

```typescript
{
    role: "user";
    content: string;
    timestamp?: string;
}
```

#### Assistant Message

```typescript
{
    role: "assistant";
    content: string;
    agentName?: string;
    responseType?: "internal" | "external";
    timestamp?: string;
}
```

#### Assistant Message with Tool Calls

```typescript
{
    role: "assistant";
    content?: string | null;      // Can be null when making tool calls
    toolCalls: ToolCall[];
    agentName?: string;
    timestamp?: string;
}
```

#### Tool Call

```typescript
{
    id: string;
    type: "function";
    function: {
        name: string;             // Name of the invocated tool call
        arguments: string;        // JSON string containing the tool calls arguments
    };
}
```

#### Tool Message

```typescript
{
    role: "tool";
    content: string;              // JSON String containing tool response
    toolCallId: string;           // Links Tool call responses to tool invocations
    toolName: string;
    timestamp?: string;
}
```

### Response Schema

```typescript
{
    conversationId: string;      // Conversation ID for future requests
    turn: {
        id: string;
        reason: {
            type: "api";         // Indicates this turn was triggered by an API call
        };
        input: {
            messages: Message[]; // The messages that were sent in the request
        };
        output: Message[];       // Array of new messages generated in this turn
        createdAt: string;       // ISO 8601 timestamp of when the turn was created
    };
}
```
## Important Notes

1. Always pass the new messages in the `messages` array
2. Include the `conversationId` from the previous response to continue the conversation
3. The conversation history is automatically maintained by Rowboat
4. The last message in the response's `turn.output` array will typically be a user-facing assistant message (`responseType: "external"`)

## Rate Limiting

The API has rate limits per project. If exceeded, you'll receive a 429 status code.

## Error Responses

-   400: Invalid request body or missing/invalid Authorization header
-   403: Invalid API key
-   404: Project or workflow not found
-   429: Rate limit exceeded
