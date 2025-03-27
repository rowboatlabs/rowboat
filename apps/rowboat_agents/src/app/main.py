from quart import Quart, request, jsonify, Response
from datetime import datetime
from functools import wraps
import os
import redis
import uuid
import json
from hypercorn.config import Config
from hypercorn.asyncio import serve
import asyncio

from src.graph.core import run_turn, run_turn_streamed
from src.graph.tools import RAG_TOOL, CLOSE_CHAT_TOOL
from src.utils.common import common_logger, read_json_from_file

from pprint import pprint

logger = common_logger
redis_client = redis.from_url(os.environ.get('REDIS_URL', 'redis://localhost:6379'))
app = Quart(__name__)

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
        config = read_json_from_file("./configs/default_config.json")

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

        print("Request:")
        pprint(request_data)

        data = request_data
        resp_messages, resp_tokens_used, resp_state = await run_turn(
            messages=input_messages,
            start_agent_name=data.get("startAgent", ""),
            agent_configs=data.get("agents", []),
            tool_configs=data.get("tools", []),
            start_turn_with_start_agent=config.get("start_turn_with_start_agent", False),
            state=data.get("state", {}),
            additional_tool_configs=[RAG_TOOL, CLOSE_CHAT_TOOL],
            complete_request=data
        )

        logger.info('-'*100)
        logger.info('Raw output:')
        logger.info((resp_messages, resp_tokens_used, resp_state))

        out = {
            "messages": resp_messages,
            "tokens_used": resp_tokens_used,
            "state": resp_state,
        }

        logger.info("Output:")
        for k, v in out.items():
            logger.info(f"{k}: {v}")
            logger.info('*'*100)

        return jsonify(out)

    except Exception as e:
        logger.error(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/chat_stream_init", methods=["POST"])
@require_api_key
async def chat_stream_init():
    # create a uuid for the stream
    stream_id = str(uuid.uuid4())

    # store the request data in redis with 10 minute TTL
    data = await request.get_json()
    redis_client.setex(f"stream_request_{stream_id}", 600, json.dumps(data))

    return jsonify({"streamId": stream_id})

def format_sse(data: dict, event: str = None) -> str:
    msg = f"data: {json.dumps(data)}\n\n"
    if event is not None:
        msg = f"event: {event}\n{msg}"
    return msg

@app.route("/chat_stream/<stream_id>", methods=["GET"])
@require_api_key
async def chat_stream(stream_id):
    # get the request data from redis
    request_data = redis_client.get(f"stream_request_{stream_id}")
    if not request_data:
        return jsonify({"error": "Stream not found"}), 404

    request_data = json.loads(request_data)
    config = read_json_from_file("./configs/default_config.json")

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

    print("Request:")
    pprint(request_data)

    async def generate():
        try:
            async for event_type, event_data in run_turn_streamed(
                messages=input_messages,
                start_agent_name=request_data.get("startAgent", ""),
                agent_configs=request_data.get("agents", []),
                tool_configs=request_data.get("tools", []),
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

        except Exception as e:
            logger.error(f"Streaming error: {str(e)}")
            yield format_sse({"error": str(e)}, "error")

    return Response(generate(), mimetype='text/event-stream')

if __name__ == "__main__":
    print("Starting async server...")
    config = Config()
    config.bind = ["0.0.0.0:4040"]
    asyncio.run(serve(app, config))