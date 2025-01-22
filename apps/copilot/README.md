# AI Workflow Copilot

A Flask-based application that helps design and manage multi-agent AI systems for customer support.

## Prerequisites

- Python 3.8+
- One of the following:
  - OpenAI API key for GPT-4
  - AWS credentials for Bedrock access

## Installation

1. Clone the repository:
2. Create and activate a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows, use: venv\Scripts\activate
```

3. Install required dependencies:
```bash
pip install -r requirements.txt
```

4. Configure your AI provider:

   **Option 1: OpenAI**
   ```bash
   export MODEL='openai/gpt-4o'
   export OPENAI_API_KEY='your-api-key-here'
   ```

   **Option 2: AWS Bedrock**
   ```bash
   export MODEL='aws/us.anthropic.claude-3-sonnet-20240229-v1:0'
   export AWS_ACCESS_KEY_ID='your-aws-access-key'
   export AWS_SECRET_ACCESS_KEY='your-aws-secret-key'
   export AWS_REGION='your-aws-region'
   ```

## Running the Application

1. Start the Flask server:
```bash
python app.py
```

The server will start on `http://localhost:5000`

## API Usage

The application exposes a single endpoint at `/chat` that accepts POST requests.

### Example Request:
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Your message here"
    }
  ],
  "workflow_schema": "Your workflow schema here",
  "current_workflow_config": "Your current workflow configuration here"
}
```

### Example Response:
```json
{
  "response": "Assistant's response here"
}
```

## Error Handling

The API returns appropriate HTTP status codes:
- 400: Invalid request format or data
- 500: Internal server error

## Development

To run the server in debug mode, ensure `debug=True` is set in `app.py` (already included).

## License

[Add your license information here] 