import copy
from datetime import datetime
import json
import sys
import asyncio
import requests
import argparse

from src.utils.common import common_logger, read_json_from_file
logger = common_logger

def preprocess_messages(messages):
    # Preprocess messages to handle null content and role issues
    for msg in messages:
        # Handle null content in assistant messages with tool calls
        if (msg.get("role") == "assistant" and 
            msg.get("content") is None and 
            msg.get("tool_calls") is not None and 
            len(msg.get("tool_calls")) > 0):
            msg["content"] = "Calling tool"
            
        # Handle role issues
        if msg.get("role") == "tool":
            msg["role"] = "developer"
        elif not msg.get("role"):
            msg["role"] = "user"
    
    return messages

def stream_chat(host, request_data, api_key):
    start_time = datetime.now()
    print("\n" + "="*80)
    print(f"Starting streaming chat at {start_time}")
    print(f"Host: {host}")
    print("="*80 + "\n")

    try:
        print("\n" + "-"*80)
        print("Connecting to stream...")
        stream_response = requests.post(
            f"{host}/chat_stream",
            json=request_data,
            headers={
                'Authorization': f'Bearer {api_key}',
                'Accept': 'text/event-stream'
            },
            stream=True
        )
        
        if stream_response.status_code != 200:
            print(f"Error connecting to stream. Status code: {stream_response.status_code}")
            print(f"Response: {stream_response.text}")
            return None, None
            
        print(f"Successfully connected to stream")
        print("-"*80 + "\n")

        event_count = 0
        collected_messages = []
        final_state = None
        
        try:
            print("\n" + "-"*80)
            print("Starting to process events...")
            print("-"*80 + "\n")
            
            for line in stream_response.iter_lines(decode_unicode=True):
                if line:
                    if line.startswith('data: '):
                        data = line[6:]  # Remove 'data: ' prefix
                        try:
                            event_data = json.loads(data)
                            event_count += 1
                            print("\n" + "*"*80)
                            print(f"Event #{event_count} at {datetime.now().isoformat()}")
                            
                            if isinstance(event_data, dict):
                                # Pretty print the event data
                                print("Event Data:")
                                print(json.dumps(event_data, indent=2))
                                
                                # Special handling for message events
                                if 'content' in event_data:
                                    print("\nMessage Content:", event_data['content'])
                                    if event_data.get('tool_calls'):
                                        print("Tool Calls:", json.dumps(event_data['tool_calls'], indent=2))
                                    
                                    # Collect messages
                                    collected_messages.append(event_data)
                            else:
                                print("Event Data:", event_data)
                            print("*"*80 + "\n")
                            
                        except json.JSONDecodeError as e:
                            print(f"Error decoding event data: {e}")
                            print(f"Raw data: {data}")
                
        except Exception as e:
            print(f"Error processing stream: {e}")
            import traceback
            traceback.print_exc()
        finally:
            print("\n" + "-"*80)
            print(f"Closing stream after processing {event_count} events")
            print("-"*80 + "\n")
            stream_response.close()
            
    except requests.exceptions.RequestException as e:
        print(f"Request error during streaming: {e}")
        import traceback
        traceback.print_exc()

    end_time = datetime.now()
    duration = end_time - start_time
    print("\n" + "="*80)
    print(f"Streaming session completed at {end_time}")
    print(f"Total duration: {duration}")
    print("="*80 + "\n")
    
    return collected_messages, final_state

if __name__ == "__main__":
    logger.info(f"{'*'*50}Running interactive mode{'*'*50}")

    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=str, required=False, default='default_config.json',
                       help='Config file name under configs/')
    parser.add_argument('--sample_request', type=str, required=False, default='default_example.json',
                       help='Sample request JSON file name under tests/sample_requests/')
    parser.add_argument('--api_key', type=str, required=False, default='test',
                       help='API key to use for authentication')
    parser.add_argument('--host', type=str, default='http://localhost:4040',
                       help='Host to use for the request')
    parser.add_argument('--load_messages', action='store_true',
                       help='Load messages from sample request file')
    args = parser.parse_args()

    print(f"Config file: {args.config}")
    print(f"Sample request file: {args.sample_request}")
    
    config = read_json_from_file(f"./configs/{args.config}")
    example_request = read_json_from_file(f"./tests/sample_requests/{args.sample_request}").get("lastRequest", {})
    
    if args.load_messages:
        messages = example_request.get("messages", [])
        user_input_needed = False
    else:
        messages = []
        user_input_needed = True

    state = example_request.get("state", {})
    start_agent_name = example_request.get("startAgent", "")
    last_agent_name = state.get("last_agent_name", "")
    if not last_agent_name:
        last_agent_name = start_agent_name

    logger.info("Starting main conversation loop")
    start_time = None
    while True:
        logger.info("Loading configuration files")

        # To account for updates to state
        complete_request = copy.deepcopy(example_request)
        complete_request["messages"] = messages
        complete_request["state"] = state
        complete_request["startAgent"] = start_agent_name

        print(f"\nUsing agent: {last_agent_name}")
        
        if user_input_needed:
            user_inp = input('\nUSER: ')
            messages.append({
                "role": "user",
                "content": user_inp
            })
            if user_inp == 'exit':
                logger.info("User requested exit")
                break
            logger.info("Added user message to conversation")
        
        start_time = datetime.now()

        # Preprocess messages
        print("Preprocessing messages")
        messages = preprocess_messages(messages)
        complete_request["messages"] = preprocess_messages(complete_request["messages"])

        # Run the streaming turn
        resp_messages, resp_state = stream_chat(
            host=args.host,
            request_data=complete_request,
            api_key=args.api_key
        )
        
        if resp_messages:
            state = resp_state
            if config.get("return_diff_messages", True):
                messages.extend(resp_messages)
            else:
                messages = resp_messages

        user_input_needed = True
        print("Quick stats")
        print(f"Turn Duration: {round((datetime.now() - start_time).total_seconds() * 10) / 10:.1f}s")
        print('='*50)
            
    print("\n" + "-" * 80)