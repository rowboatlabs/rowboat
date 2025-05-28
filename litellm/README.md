# LiteLLM Modal Handler

This project provides integration between LiteLLM and Modal's Ollama server, enabling seamless use of various LLM models through Modal's infrastructure.

## Project Structure

The custom handler should be placed in your LiteLLM project directory as follows:

```
your-litellm-project/
├── litellm/
│   ├── custom_handler.py  # Place the Modal handler here
│   └── __init__.py
├── config.yaml
└── requirements.txt
```

To set this up:

1. Create the `litellm` directory if it doesn't exist:
```bash
mkdir -p litellm
```

2. Copy the custom handler file:
```bash
cp handler/custom_handler.py litellm/
```

3. Create an empty `__init__.py` file:
```bash
touch litellm/__init__.py
```

This structure ensures that the custom handler is properly recognized by LiteLLM when referenced in the config.yaml as `litellm.custom_handler.modal_llm`.

## Features

- Integration with Modal's Ollama server
- Support for multiple LLM models including:
  - Llama4 (new!)
  - Gemma3
  - Other Ollama-compatible models
- Asynchronous and streaming support
- Tool calling capabilities
- Comprehensive error handling and logging
- Support for both synchronous and asynchronous operations

## Dependencies

The handler requires the following Python packages:

```bash
pip install litellm requests aiohttp python-dotenv typing-extensions asyncio uuid
```

## Environment Variables

The handler requires the following environment variables to be set:

```bash
export TOKEN_ID="your_modal_token_id"
export TOKEN_SECRET="your_modal_token_secret"
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/stevef1uk/modal_ollama_gemma3_gradio.git
cd modal_ollama_gemma3_gradio
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Set up Modal and Ollama:
Follow the instructions in the [Modal Ollama Setup Guide](https://github.com/stevef1uk/modal_ollama_gemma3_gradio) to:
- Set up a Modal account
- Deploy the Ollama server
- Install the Llama4 model

## Configuration

### Customizing the Modal API Base URL

By default, the handler uses a specific Modal API base URL. To use your own Modal deployment, you can customize the API base URL in two ways:

1. When initializing the handler:
```python
from litellm.custom_handler import modal_llm

# Initialize with custom API base
modal_llm = modal_llm(api_base="https://your-username--ollama-api-api.modal.run")
```

2. Or by setting the environment variable:
```bash
export MODAL_API_BASE="https://your-username--ollama-api-api.modal.run"
```

Replace `your-username` with your Modal username. The URL format should be:
`https://{username}--ollama-api-api.modal.run`

### Configuring in LiteLLM config.yaml

To use the Modal handler with LiteLLM's configuration system, add the following to your `config.yaml`:

```yaml
# Model configuration
model_list:
  - model_name: "modal/llama4"
    litellm_params:
      model: "modal/llama4"
      api_base: "https://your-username--ollama-api-api.modal.run"
      provider: "modal"

# Optional: Set default model for unspecified requests
default_model: llama4

# Server configurations
server:
  port: 4000
  host: 0.0.0.0

# General settings for pass-through endpoints
general_settings:
  pass_through_endpoints:
    - path: "/modal/tensorrt"
      target: "https://your-username--ollama-api-api.modal.run"
      headers:
        Modal-Key: os.environ/TOKEN_ID
        Modal-Secret: os.environ/TOKEN_SECRET
        content-type: application/json
        accept: application/json
      forward_headers: true  # Forward all headers from the incoming request

# Register custom provider
litellm_settings:
  custom_provider_map:
    - provider: "modal"
      custom_handler: "litellm.custom_handler.modal_llm"
```

Then you can use it with LiteLLM like this:

```python
from litellm import completion

# Using Llama4
response = completion(
    model="modal/llama4",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is the capital of France?"}
    ]
)
```

The configuration supports all features including:
- Tool calling
- Streaming
- Async completion
- Custom parameters (temperature, max_tokens, etc.)

Key points about the configuration:
1. The `provider` field must be set to "modal"
2. The `custom_provider_map` links the "modal" provider to our custom handler
3. Environment variables `TOKEN_ID` and `TOKEN_SECRET` are used for authentication
4. The pass-through endpoint configuration allows direct access to the Modal API

## Usage

### Basic Completion

```python
from litellm.custom_handler import modal_llm

# Basic completion
response = modal_llm.completion(
    model="modal/llama4",  # Use Llama4 model
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is the capital of France?"}
    ],
    temperature=0.7
)
```

### Async Completion

```python
async def get_completion():
    response = await modal_llm.acompletion(
        model="modal/llama4",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What is the capital of France?"}
        ],
        temperature=0.7
    )
    return response
```

### Streaming

```python
async def stream_completion():
    async for chunk in modal_llm.astreaming(
        model="modal/llama4",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What is the capital of France?"}
        ],
        temperature=0.7
    ):
        print(chunk)
```

### Tool Calling

```python
tools = [
    {
        "function": {
            "name": "get_weather",
            "description": "Get the current weather in a given location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The city and state, e.g. San Francisco, CA"
                    }
                },
                "required": ["location"]
            }
        }
    }
]

response = modal_llm.completion(
    model="modal/llama4",
    messages=[
        {"role": "system", "content": "You are a helpful assistant that uses tools when available."},
        {"role": "user", "content": "What's the weather like in London?"}
    ],
    tools=tools,
    temperature=0.7
)
```

## Testing

The handler includes a comprehensive test suite. To run the tests:

```bash
python test_modal_handler.py
```

The test suite includes:
- Structured tool calling tests
- Response format validation
- Regular completion tests
- Async completion tests
- Streaming tests

### Example Test Outputs

Here's what you can expect when running the tests:

#### 1. Structured Tool Calling Test
```json
{
  "id": "modal-response",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "function": {
              "name": "get_weather",
              "arguments": "{\"location\": \"London\"}"
            },
            "id": "call_123",
            "type": "function"
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ],
  "created": 0,
  "model": "modal/llama4",
  "usage": {}
}
```

#### 2. Regular Completion Test
```json
{
  "id": "modal-response",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "The capital of France is Paris."
      },
      "finish_reason": "stop"
    }
  ],
  "created": 0,
  "model": "modal/llama4",
  "usage": {}
}
```

#### 3. Async Completion Test
```json
{
  "id": "modal-response",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "The capital of France is Paris. I can confirm this using my available information. Would you like to know more about Paris or France in general?"
      },
      "finish_reason": "stop"
    }
  ],
  "created": 0,
  "model": "modal/llama4",
  "usage": {}
}
```

#### 4. Streaming Test
```json
// First chunk
{
  "text": "The capita",
  "is_finished": false,
  "finish_reason": null,
  "usage": {
    "prompt_tokens": 34,
    "completion_tokens": 6,
    "total_tokens": 40
  }
}

// Middle chunk
{
  "text": "l of Franc",
  "is_finished": false,
  "finish_reason": null,
  "usage": {
    "prompt_tokens": 34,
    "completion_tokens": 6,
    "total_tokens": 40
  }
}

// Final chunk
{
  "text": "e is Paris.",
  "is_finished": true,
  "finish_reason": "stop",
  "usage": {
    "prompt_tokens": 34,
    "completion_tokens": 6,
    "total_tokens": 40
  }
}
```

## Running in Kubernetes

To run the LiteLLM proxy in a Kubernetes cluster, you'll need to set up the following environment variables and configuration.

### Environment Variables

```bash
# API Keys
export OPENAI_API_KEY="your-openai-api-key"
export GROQ_API_KEY="your-groq-api-key"
export LITELLM_MASTER_KEY="your-litellm-master-key"
export LITELLM_SALT_KEY="your-litellm-salt-key"

# Database Configuration
# For local development:
export DATABASE_URL="postgres://username:password@db:5432/database_name"
# For Kubernetes (adjust based on your cluster's PostgreSQL service):
export DATABASE_URL="postgres://username:password@postgres-service:5432/database_name"
```

### Running the Proxy

To start the LiteLLM proxy with your Modal configuration:

```bash
litellm --config config.yaml
```

### Kubernetes Deployment

Here's an example Kubernetes deployment configuration:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: litellm-proxy
spec:
  replicas: 1
  selector:
    matchLabels:
      app: litellm-proxy
  template:
    metadata:
      labels:
        app: litellm-proxy
    spec:
      containers:
      - name: litellm-proxy
        image: your-litellm-image:tag
        env:
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: litellm-secrets
              key: openai-api-key
        - name: GROQ_API_KEY
          valueFrom:
            secretKeyRef:
              name: litellm-secrets
              key: groq-api-key
        - name: LITELLM_MASTER_KEY
          valueFrom:
            secretKeyRef:
              name: litellm-secrets
              key: litellm-master-key
        - name: LITELLM_SALT_KEY
          valueFrom:
            secretKeyRef:
              name: litellm-secrets
              key: litellm-salt-key
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: litellm-secrets
              key: database-url
        - name: TOKEN_ID
          valueFrom:
            secretKeyRef:
              name: modal-secrets
              key: token-id
        - name: TOKEN_SECRET
          valueFrom:
            secretKeyRef:
              name: modal-secrets
              key: token-secret
        ports:
        - containerPort: 4000
        command: ["litellm"]
        args: ["--config", "/app/config.yaml"]
        volumeMounts:
        - name: config-volume
          mountPath: /app/config.yaml
          subPath: config.yaml
      volumes:
      - name: config-volume
        configMap:
          name: litellm-config
---
apiVersion: v1
kind: Service
metadata:
  name: litellm-proxy
spec:
  selector:
    app: litellm-proxy
  ports:
  - port: 4000
    targetPort: 4000
  type: ClusterIP
```

### Kubernetes Secrets

Create the necessary secrets for your deployment:

```bash
# Create secrets for LiteLLM
kubectl create secret generic litellm-secrets \
  --from-literal=openai-api-key='your-openai-api-key' \
  --from-literal=groq-api-key='your-groq-api-key' \
  --from-literal=litellm-master-key='your-litellm-master-key' \
  --from-literal=litellm-salt-key='your-litellm-salt-key' \
  --from-literal=database-url='postgres://username:password@postgres-service:5432/database_name'

# Create secrets for Modal
kubectl create secret generic modal-secrets \
  --from-literal=token-id='your-modal-token-id' \
  --from-literal=token-secret='your-modal-token-secret'
```

### ConfigMap

Create a ConfigMap for your config.yaml:

```bash
kubectl create configmap litellm-config --from-file=config.yaml
```

### Important Notes

1. Update the PostgreSQL connection string to point to your cluster's PostgreSQL service
2. Store sensitive information in Kubernetes secrets
3. Ensure your cluster has access to the Modal API endpoint
4. Consider using a service mesh or ingress controller for external access
5. Monitor the proxy's logs and metrics in your cluster

## Related Resources

- [Modal Ollama Setup Guide](https://github.com/stevef1uk/modal_ollama_gemma3_gradio) - Instructions for setting up Ollama and Llama4 on Modal
- [LiteLLM Documentation](https://docs.litellm.ai/) - Complete documentation for LiteLLM
- [Modal Documentation](https://modal.com/docs) - Modal's official documentation

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
