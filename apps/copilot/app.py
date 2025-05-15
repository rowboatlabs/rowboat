from flask import Flask, request, jsonify, Response, stream_with_context
from pydantic import BaseModel, ValidationError, Field
from typing import List, Optional
from copilot import UserMessage, AssistantMessage, get_response
from streaming import get_streaming_response
from lib import AgentContext, PromptContext, ToolContext, ChatContext
import os
from functools import wraps
from copilot import copilot_instructions_edit_agent
import json

class DataSource(BaseModel):
    id: str = Field(alias='_id')
    name: str
    description: Optional[str] = None
    active: bool = True
    status: str  # 'pending' | 'ready' | 'error' | 'deleted'
    error: Optional[str] = None
    data: dict  # The discriminated union based on type

    class Config:
        populate_by_name = True

class ApiRequest(BaseModel):
    messages: List[UserMessage | AssistantMessage]
    workflow_schema: str
    current_workflow_config: str
    context: AgentContext | PromptContext | ToolContext | ChatContext | None = None
    dataSources: Optional[List[DataSource]] = None

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

@app.route('/chat_stream', methods=['POST'])
@require_api_key
def chat_stream():
    try:
        raw_data = request.json
        print(f"Raw request JSON: {json.dumps(raw_data)}")
        
        request_data = ApiRequest(**raw_data)
        print(f"received /chat_stream request: {request_data}")
        validate_request(request_data)

        def generate():
            stream = get_streaming_response(
                messages=request_data.messages,
                workflow_schema=request_data.workflow_schema,
                current_workflow_config=request_data.current_workflow_config,
                context=request_data.context,
                dataSources=request_data.dataSources
            )

            for chunk in stream:
                if chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    yield f"data: {json.dumps({'content': content})}\n\n"

            yield "event: done\ndata: {}\n\n"

        return Response(
            stream_with_context(generate()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'
            }
        )

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
        print(f"received /edit_agent_instructions request: {request_data}")
        validate_request(request_data)

        response = get_response(
            messages=request_data.messages,
            workflow_schema=request_data.workflow_schema,
            current_workflow_config=request_data.current_workflow_config,
            context=request_data.context,
            copilot_instructions=copilot_instructions_edit_agent
        )

        api_response = ApiResponse(response=response).model_dump()
        print(f"sending /edit_agent_instructions response: {api_response}")
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