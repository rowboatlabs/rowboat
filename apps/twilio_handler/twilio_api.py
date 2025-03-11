from twilio.rest import Client as TwilioClient
from rowboat.client import Client
from rowboat.schema import UserMessage, SystemMessage
import os
from typing import Dict, List, Optional, Tuple, Any
import logging
from util import get_api_key
import time
import json

# Load environment variables
from load_env import load_environment
load_environment()

# Configure logging to stdout for Docker compatibility
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]  # Send logs to stdout
)
logger = logging.getLogger(__name__)

# Environment variables and configuration
ROWBOAT_API_HOST = os.environ.get("ROWBOAT_API_HOST").strip()

Message = UserMessage | SystemMessage

def process_conversation_turn(
    user_input: str,
    workflow_id: str,
    system_prompt: str = "You are a helpful assistant. Provide concise and clear answers.",
    previous_messages: List[Message] = None,
    previous_state: Any = None,
    project_id: str = None
) -> Tuple[str, List[Message], Any]:
    """
    Process a single conversation turn with the RowBoat agent using the stateless API.

    Args:
        user_input: User's transcribed input
        workflow_id: RowBoat workflow ID
        system_prompt: System prompt for the agent
        previous_messages: Previous messages in the conversation
        previous_state: Previous state from RowBoat
        project_id: RowBoat project ID (if different from default)

    Returns:
        A tuple of (response_text, updated_messages, updated_state)
    """
    try:
        # Initialize messages list if not provided
        messages = [] if previous_messages is None else previous_messages.copy()

        # If we're starting a new conversation, add the system message
        if not messages or not any(msg.role == 'system' for msg in messages):
            messages.append(SystemMessage(role='system', content=system_prompt))

        # Add the user's new message
        messages.append(UserMessage(role='user', content=user_input))

        # Process the conversation using the stateless API
        logger.info(f"Sending to RowBoat API with {len(messages)} messages")

        # Create client with custom project_id if provided

        client = Client(
            host=ROWBOAT_API_HOST,
            project_id=project_id,
            api_key=get_api_key(project_id)
        )

        response_messages, new_state = client.chat(
            messages=messages,
            workflow_id=workflow_id,
            state=previous_state
        )

        # Extract the assistant's response (last message)
        if response_messages and len(response_messages) > 0:
            assistant_response = response_messages[-1].content
        else:
            assistant_response = "I'm sorry, I didn't receive a proper response."

        # Update messages list with the new responses
        final_messages = messages + response_messages

        # dump_data = {
        #     'messages': [msg.model_dump() for msg in messages],
        #     'response_messages': [msg.model_dump() for msg in response_messages],
        #     'state': new_state
        # }
        # # Write messages to a debug file for inspection
        # fname = f'debug_dump_{time.time()}.json'
        # try:
        #     with open(fname, 'w') as f:
        #         json.dump(dump_data, f, indent=2)
        #     logger.info(f"Wrote debug info to {fname}")
        # except Exception as e:
        #     logger.error(f"Failed to write message debug file: {str(e)}")


        logger.info(f"Got response from RowBoat API: {assistant_response[:100]}...")
        return assistant_response, final_messages, new_state

    except Exception as e:
        logger.error(f"Error processing conversation turn: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return "I'm sorry, I encountered an error processing your request.", previous_messages, previous_state