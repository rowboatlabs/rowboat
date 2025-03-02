# LLM Router

A Python library that provides a uniform interface for OpenAI, Groq, and Claude LLM providers.

## Installation

```bash
pip install llm_router
```

## Usage

```python
from llm_router import OpenAI, Groq, Claude

# OpenAI client
openai_client = OpenAI(api_key="your-openai-api-key")
response = openai_client.chat_completion(
    messages=[{"role": "user", "content": "Hello!"}]
)

# Groq client
groq_client = Groq(api_key="your-groq-api-key")
response = groq_client.chat_completion(
    messages=[{"role": "user", "content": "Hello!"}]
)

# Claude client
claude_client = Claude(api_key="your-anthropic-api-key")
response = claude_client.chat_completion(
    messages=[{"role": "user", "content": "Hello!"}]
)
```