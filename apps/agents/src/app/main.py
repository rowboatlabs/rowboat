from flask import Flask, request, jsonify
from datetime import datetime
from functools import wraps
import os

from src.graph.core import run_turn
from src.graph.tools import RAG_TOOL, CLOSE_CHAT_TOOL

from src.utils.common import common_logger, read_json_from_file
logger = common_logger

app = Flask(__name__)
 
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

@app.route("/")
def home():
    return "Hello, World!"

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

@app.route("/chat", methods=["POST"])
@require_api_key
def chat():
    logger.info('='*200)
    logger.info(f"{'*'*50}Running server mode{'*'*50}")
    try:
        data = request.get_json()
        logger.info('Complete request:')
        logger.info(data)
        logger.info('-'*200)

        start_time = datetime.now()
        config = read_json_from_file("./configs/default_config.json")

        logger.info('Beginning turn')
        resp_messages, resp_tokens_used, resp_state = run_turn(
            messages=data.get("messages", []),
            start_agent_name=data.get("startAgent", ""),
            agent_configs=data.get("agents", []),
            tool_configs=data.get("tools", []),
            start_turn_with_start_agent=config.get("start_turn_with_start_agent", False),
            state=data.get("state", {}),
            additional_tool_configs=[RAG_TOOL, CLOSE_CHAT_TOOL]
        )

        logger.info('-'*200)
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
            logger.info('*'*200)
        
        logger.info('='*200)
        logger.info(f"Processing time: {datetime.now() - start_time}")
        
        return jsonify(out)

    except Exception as e:
        logger.error(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    print("Starting Flask server...")
    app.run(port=4040, debug=True)