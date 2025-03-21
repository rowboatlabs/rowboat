import copy
from datetime import datetime
import json
import sys

from src.graph.core import run_turn, order_messages
from src.graph.tools import respond_to_tool_raise_error, respond_to_tool_close_chat, RAG_TOOL, CLOSE_CHAT_TOOL
from src.utils.common import common_logger, read_json_from_file
logger = common_logger

if __name__ == "__main__":
    logger.info(f"{'*'*50}Running interactive mode{'*'*50}")

    def extract_request_fields(complete_request):
        agent_configs = complete_request.get("agents", [])
        tool_configs = complete_request.get("tools", [])
        prompt_configs = complete_request.get("prompts", [])
        start_agent_name = complete_request.get("startAgent", "")
        
        return agent_configs, tool_configs, prompt_configs, start_agent_name
    
    external_tool_mappings = {
        "raise_error": respond_to_tool_raise_error,
        "close_chat": respond_to_tool_close_chat
    }
    
    config_file = sys.argv[sys.argv.index("--config") + 1] if "--config" in sys.argv else "default_config.json"
    sample_request_file = sys.argv[sys.argv.index("--sample_request") + 1] if "--sample_request" in sys.argv else "default_example.json"
    
    config = read_json_from_file(f"./configs/{config_file}")
    example_request = read_json_from_file(f"./tests/sample_requests/{sample_request_file}").get("lastRequest", {})
    
    if "--load_messages" in sys.argv:
        messages = example_request.get("messages", [])
        messages = order_messages(messages)
        user_input_needed = False
    else:
        messages = []
        user_input_needed = True

    turn_start_time = datetime.now()
    tool_duration = 0

    state = example_request.get("state", {})
    start_agent_name = example_request.get("startAgent", "")
    last_agent_name = state.get("last_agent_name", "")
    if not last_agent_name:
        last_agent_name = start_agent_name


    logger.info("Starting main conversation loop")
    while True:
        logger.info("Loading configuration files")

        # To account for updates to state
        complete_request = copy.deepcopy(example_request)
        agent_configs, tool_configs, prompt_configs, start_agent_name = extract_request_fields(complete_request)

        print(f"\nUsing agent: {last_agent_name}")
        
        if user_input_needed:
            user_inp = input('\nUSER: ')
            messages.append({
                "role": "user",
                "content": user_inp
            })
            turn_start_time = datetime.now()
            tool_duration = 0
            if user_inp == 'exit':
                logger.info("User requested exit")
                break
            logger.info("Added user message to conversation")

        print(f"\n{'*'*50}\nLatest Request:\n{'*'*50}")
        request_json = {
            "messages": [{k: v for k, v in msg.items() if k != 'current_turn'} for msg in messages],
            "state": state,
            "agents": agent_configs,
            "tools": tool_configs,
            "prompts": prompt_configs,
            "startAgent": start_agent_name
        }
        print(json.dumps(request_json, indent=2))

        resp_messages, resp_tokens_used, resp_state = run_turn(
            messages=messages,
            start_agent_name=start_agent_name,
            agent_configs=agent_configs,
            tool_configs=tool_configs,
            start_turn_with_start_agent=config.get("start_turn_with_start_agent", False),
            state=state,
            additional_tool_configs=[RAG_TOOL, CLOSE_CHAT_TOOL]
        )
        state = resp_state
        resp_messages = order_messages(resp_messages)

        print(f"\n{'*'*50}\nLatest Response:\n{'*'*50}")
        response_json = {
            "messages": resp_messages,
            "state": state,
            "tokens_used": resp_tokens_used
        }
        print(json.dumps(response_json, indent=2))
        
        last_msg = resp_messages[-1]
        print(f"\nBOT: {last_msg}\n")
        tool_calls = last_msg.get("tool_calls", [])
        sender = last_msg.get("sender", "")
            
        if config.get("return_diff_messages", True):
            messages.extend(resp_messages)
        else:
            messages = resp_messages

        if tool_calls:
            tool_start_time = datetime.now()
            user_input_needed = False

            should_break = False
            for tool_call in tool_calls:
                tool_name = tool_call["function"]["name"]
                logger.info(f"Processing tool call: {tool_name}")

                if tool_name not in external_tool_mappings:
                    logger.error(f"Unknown tool call: {tool_name}")
                    raise ValueError(f"Unknown tool call: {tool_name}")

                # Call appropriate handler and process response
                tool_response = external_tool_mappings[tool_name]([tool_call], mock=True)
                messages.append(tool_response)
                logger.info(f"Added {tool_name} response to messages")

                current_tool_duration = round((datetime.now() - tool_start_time).total_seconds() * 10) / 10
                logger.info(f"Tool response duration: {current_tool_duration:.1f}s")
                tool_duration += current_tool_duration
                
                if tool_name == "close_chat":
                    user_input_needed = False
                    logger.info("Closing chat")
                    should_break = True

            if should_break:
                break
        
        else:
            user_input_needed = True
            print(f"Turn Duration: {round((datetime.now() - turn_start_time).total_seconds() * 10) / 10:.1f}s\n")
            print(f"Tool Response Duration: {round(tool_duration * 10) / 10:.1f}s\n")
            
    print("\n" + "-" * 80)