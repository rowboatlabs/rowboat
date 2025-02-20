from flask import Flask, request, jsonify
from pydantic import BaseModel, ValidationError
from typing import List
from copilot import UserMessage, AssistantMessage, get_response
from lib import AgentContext, PromptContext, ToolContext, ChatContext
import os
from functools import wraps
from copilot import copilot_instructions, copilot_instructions_edit_agent

class ApiRequest(BaseModel):
    messages: List[UserMessage | AssistantMessage]
    workflow_schema: str
    current_workflow_config: str
    context: AgentContext | PromptContext | ToolContext | ChatContext | None = None

class ApiResponse(BaseModel):
    response: str


app = Flask(__name__)

def validate_request(request_data: ApiRequest) -> None:
    """Validate the chat request data."""
    if not request_data.messages:
        raise ValueError('Messages list cannot be empty')

    if not isinstance(request_data.messages[-1], UserMessage):
        raise ValueError('Last message must be a user message')

def require_api_key(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Missing or invalid authorization header'}), 401

        token = auth_header.split('Bearer ')[1]
        actual = os.environ.get('API_KEY', '').strip()
        if actual and token != actual:
            return jsonify({'error': 'Invalid API key'}), 403

        return f(*args, **kwargs)
    return decorated

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})

@app.route('/chat', methods=['POST'])
@require_api_key
def chat():
    try:
        request_data = ApiRequest(**request.json)
        validate_request(request_data)

        response = get_response(
            messages=request_data.messages,
            workflow_schema=request_data.workflow_schema,
            current_workflow_config=request_data.current_workflow_config,
            context=request_data.context,
            copilot_instructions=copilot_instructions
        )
        api_response = ApiResponse(response=response).model_dump()

        return jsonify(api_response)

    except ValidationError as ve:
        print(ve)
        return jsonify({
            'error': 'Invalid request format',
            'details': str(ve)
        }), 400
    except ValueError as ve:
        print(ve)
        return jsonify({
            'error': 'Invalid request data',
            'details': str(ve)
        }), 400
    except Exception as e:
        print(e)
        return jsonify({
            'error': 'Internal server error',
            'details': str(e)
        }), 500

@app.route('/edit_agent_instructions', methods=['POST'])
@require_api_key
def edit_agent_instructions():
    try:
        request_data = ApiRequest(**request.json)
        validate_request(request_data)

        response = get_response(
            messages=request_data.messages,
            workflow_schema=request_data.workflow_schema,
            current_workflow_config=request_data.current_workflow_config,
            context=request_data.context,
            copilot_instructions=copilot_instructions_edit_agent
        )

        api_response = ApiResponse(response=response).model_dump()
        return jsonify(api_response)

    except ValidationError as ve:
        print(ve)
        return jsonify({
            'error': 'Invalid request format',
            'details': str(ve)
        }), 400
    except ValueError as ve:
        print(ve)
        return jsonify({
            'error': 'Invalid request data',
            'details': str(ve)
        }), 400
    except Exception as e:
        print(e)
        return jsonify({
            'error': 'Internal server error',
            'details': str(e)
        }), 500

if __name__ == '__main__':
    print("Starting Flask server...")
    app.run(port=3002, host='0.0.0.0', debug=True)