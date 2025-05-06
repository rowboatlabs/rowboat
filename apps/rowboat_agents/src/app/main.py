import traceback
from quart import Quart, request, jsonify, Response
from datetime import datetime
from functools import wraps
import os
import json
from hypercorn.config import Config
from hypercorn.asyncio import serve
import asyncio

from src.graph.core import run_turn_streamed
from src.graph.tools import RAG_TOOL, CLOSE_CHAT_TOOL
from src.utils.common import common_logger, read_json_from_file

logger = common_logger
app = Quart(__name__)
config = read_json_from_file("./configs/default_config.json")

# filter out agent transfer messages using a function
def is_agent_transfer_message(msg):
    if (msg.get("role") == "assistant" and
            msg.get("content") is None and
            msg.get("tool_calls") is not None and
            len(msg.get("tool_calls")) > 0 and
            msg.get("tool_calls")[0].get("function").get("name") == "transfer_to_agent"):
        return True
    if (msg.get("role") == "tool" and
            msg.get("tool_calls") is None and
            msg.get("tool_call_id") is not None and
            msg.get("tool_name") == "transfer_to_agent"):
        return True
    return False

@app.route("/health", methods=["GET"])
async def health():
    return jsonify({"status": "ok"})

@app.route("/")
async def home():
    return "Hello, World!"

def require_api_key(f):
    @wraps(f)
    async def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Missing or invalid authorization header'}), 401

        token = auth_header.split('Bearer ')[1]
        actual = os.environ.get('API_KEY', '').strip()
        if actual and token != actual:
            return jsonify({'error': 'Invalid API key'}), 403

        return await f(*args, **kwargs)
    return decorated

@app.route("/chat", methods=["POST"])
@require_api_key
async def chat():
    logger.info('='*100)
    logger.info(f"{'*'*100}Running server mode{'*'*100}")
    try:
        request_data = await request.get_json()
        print("Request:", json.dumps(request_data))

        # filter out agent transfer messages
        input_messages = [msg for msg in request_data["messages"] if not is_agent_transfer_message(msg)]

        # Preprocess messages to handle null content and role issues
        for msg in input_messages:
            if (msg.get("role") == "assistant" and
                msg.get("content") is None and
                msg.get("tool_calls") is not None and
                len(msg.get("tool_calls")) > 0):
                msg["content"] = "Calling tool"

            if msg.get("role") == "tool":
                msg["role"] = "developer"
            elif not msg.get("role"):
                msg["role"] = "user"

        data = request_data
        messages = []
        final_state = {}
        # tokens_used = 0

        async for event_type, event_data in run_turn_streamed(
            messages=input_messages,
            start_agent_name=data.get("startAgent", ""),
            agent_configs=data.get("agents", []),
            tool_configs=data.get("tools", []),
            prompt_configs=data.get("prompts", []),
            start_turn_with_start_agent=config.get("start_turn_with_start_agent", False),
            state=data.get("state", {}),
            additional_tool_configs=[RAG_TOOL, CLOSE_CHAT_TOOL],
            complete_request=data
        ):
            if event_type == 'message':
                messages.append(event_data)
            elif event_type == 'done':
                final_state = event_data['state']
                # tokens_used = event_data["tokens_used"]

        out = {
            "messages": messages,
            "state": final_state,
        }

        logger.info("Output:")
        for k, v in out.items():
            logger.info(f"{k}: {v}")
            logger.info('*'*100)

        return jsonify(out)

    except Exception as e:
        print(traceback.format_exc())
        logger.error(f"Error: {str(e)}")
        return jsonify({"error": str(e)}), 500

def format_sse(data: dict, event: str = None) -> str:
    msg = f"data: {json.dumps(data)}\n\n"
    if event is not None:
        msg = f"event: {event}\n{msg}"
    return msg

@app.route("/chat_stream", methods=["POST"])
@require_api_key
async def chat_stream():
    # get the request data from the request
    request_data = await request.get_data()

    print("Request:", request_data.decode('utf-8'))
    request_data = json.loads(request_data)

    # filter out agent transfer messages
    input_messages = [msg for msg in request_data["messages"] if not is_agent_transfer_message(msg)]

    # Preprocess messages to handle null content and role issues
    for msg in input_messages:
        if (msg.get("role") == "assistant" and
            msg.get("content") is None and
            msg.get("tool_calls") is not None and
            len(msg.get("tool_calls")) > 0):
            msg["content"] = "Calling tool"

        if msg.get("role") == "tool":
            msg["role"] = "developer"
        elif not msg.get("role"):
            msg["role"] = "user"

    async def generate():
        try:
            async for event_type, event_data in run_turn_streamed(
                messages=input_messages,
                start_agent_name=request_data.get("startAgent", ""),
                agent_configs=request_data.get("agents", []),
                tool_configs=request_data.get("tools", []),
                prompt_configs=request_data.get("prompts", []),
                start_turn_with_start_agent=config.get("start_turn_with_start_agent", False),
                state=request_data.get("state", {}),
                additional_tool_configs=[RAG_TOOL, CLOSE_CHAT_TOOL],
                complete_request=request_data
            ):
                if event_type == 'message':
                    print("Yielding message:")
                    yield format_sse(event_data, "message")
                elif event_type == 'done':
                    print("Yielding done:")
                    yield format_sse(event_data, "done")
                elif event_type == 'error':
                    print("Yielding error:")
                    yield format_sse(event_data, "stream_error")

        except Exception as e:
            logger.error(f"Streaming error: {str(e)}")
            yield format_sse({"error": str(e)}, "error")

    return Response(generate(), mimetype='text/event-stream')

if __name__ == "__main__":
    print("Starting async server...")
    config = Config()
    config.bind = ["0.0.0.0:4040"]
    asyncio.run(serve(app, config))