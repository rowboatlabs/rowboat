import traceback
from copy import deepcopy
from datetime import datetime
import json
import uuid
import logging
from .helpers.access import (
    get_agent_by_name,
    get_external_tools,
    get_prompt_by_type
)

from .helpers.control import get_last_agent_name
from .swarm_wrapper import run_streamed as swarm_run_streamed, get_agents
from src.utils.common import common_logger as logger

from .types import PromptType

# Create a dedicated logger for swarm wrapper
logger.setLevel(logging.INFO)
print("Logger level set to INFO")

def order_messages(messages):
    """
    Sorts each message's keys in a specified order and returns a new list of ordered messages.
    """
    ordered_messages = []
    for msg in messages:
        # Filter out None values
        msg = {k: v for k, v in msg.items() if v is not None}

        # Specify the exact order
        ordered = {}
        for key in ['role', 'sender', 'content', 'created_at', 'timestamp']:
            if key in msg:
                ordered[key] = msg[key]

        # Add remaining keys in alphabetical order
        remaining_keys = sorted(k for k in msg if k not in ordered)
        for key in remaining_keys:
            ordered[key] = msg[key]

        ordered_messages.append(ordered)
    return ordered_messages

def set_sys_message(messages):
    """
    If the system message is empty, set it to the default message: "You are a helplful assistant."
    """
    if messages[0].get("role") == "system" and messages[0].get("content") == "":
        messages[0]["content"] = "You are a helpful assistant."
        print("Updated system message: ", messages[0])
        logger.info("Updated system message: ", messages[0])
        print("Messages: ", messages)
        # logger.info("Messages: ", messages)
    
    return messages

async def run_turn_streamed(
    messages,
    start_agent_name,
    agent_configs,
    tool_configs,
    prompt_configs,
    start_turn_with_start_agent,
    state={},
    additional_tool_configs=[],
    complete_request={}
):
    messages = set_sys_message(messages)
    is_greeting_turn = not any(msg.get("role") != "system" for msg in messages)
    final_state = None  # Initialize outside try block
    try:
        greeting_prompt = get_prompt_by_type(prompt_configs, PromptType.GREETING)
        if is_greeting_turn:
            if not greeting_prompt:
                greeting_prompt = "How can I help you today?"
                print("Greeting prompt not found. Using default: ", greeting_prompt)
            message = {
                'content': greeting_prompt,
                'role': 'assistant',
                'sender': start_agent_name,
                'tool_calls': None,
                'tool_call_id': None,
                'tool_name': None,
                'response_type': 'external'
            }
            print("Yielding greeting message: ", message)
            yield ('message', message)

            final_state = {
                "last_agent_name": start_agent_name if start_agent_name else None,
                "tokens": {"total": 0, "prompt": 0, "completion": 0}
            }
            print("Yielding done message")
            yield ('done', {'state': final_state})
            return
        
        # Initialize agents and get external tools
        new_agents = get_agents(agent_configs=agent_configs, tool_configs=tool_configs, complete_request=complete_request)
        last_agent_name = get_last_agent_name(
            state=state,
            agent_configs=agent_configs,
            start_agent_name=start_agent_name,
            msg_type="user",
            latest_assistant_msg=None,
            start_turn_with_start_agent=start_turn_with_start_agent
        )
        last_new_agent = get_agent_by_name(last_agent_name, new_agents)
        external_tools = get_external_tools(tool_configs)

        current_agent = last_new_agent
        tokens_used = {"total": 0, "prompt": 0, "completion": 0}

        stream_result = await swarm_run_streamed(
            agent=last_new_agent,
            messages=messages,
            external_tools=external_tools,
            tokens_used=tokens_used
        )

        # Process streaming events
        async for event in stream_result.stream_events():
            print('='*50)
            print("Received event: ", event)
            print('-'*50)

            # Handle raw response events and accumulate tokens
            if event.type == "raw_response_event":
                if hasattr(event.data, 'type') and event.data.type == "response.completed" and event.data.response.usage:
                    if hasattr(event.data.response, 'usage'):
                        tokens_used["total"] += event.data.response.usage.total_tokens
                        tokens_used["prompt"] += event.data.response.usage.input_tokens
                        tokens_used["completion"] += event.data.response.usage.output_tokens
                        print('-'*50)
                        print(f"Found usage information. Updated cumulative tokens: {tokens_used}")
                        print('-'*50)

                # Handle ResponseFunctionWebSearch specifically
                if hasattr(event, 'data') and hasattr(event.data, 'raw_item'):
                    raw_item = event.data.raw_item

                    # Check if it's a web search call
                    if (hasattr(raw_item, 'type') and raw_item.type == 'web_search_call') or (
                        isinstance(raw_item, dict) and raw_item.get('type') == 'web_search_call'
                    ):
                        # Get call_id safely, regardless of structure
                        call_id = None
                        if hasattr(raw_item, 'id'):
                            call_id = raw_item.id
                        elif isinstance(raw_item, dict) and 'id' in raw_item:
                            call_id = raw_item['id']
                        else:
                            call_id = str(uuid.uuid4())

                        # Get status safely
                        status = 'unknown'
                        if hasattr(raw_item, 'status'):
                            status = raw_item.status
                        elif isinstance(raw_item, dict) and 'status' in raw_item:
                            status = raw_item['status']

                        # Emit a tool call for web search
                        message = {
                            'content': None,
                            'role': 'assistant',
                            'sender': current_agent.name if current_agent else None,
                            'tool_calls': [{
                                'function': {
                                    'name': 'web_search',
                                    'arguments': json.dumps({
                                        'search_id': call_id,
                                        'status': status
                                    })
                                },
                                'id': call_id,
                                'type': 'function'
                            }],
                            'tool_call_id': None,
                            'tool_name': None,
                            'response_type': 'internal'
                        }
                        print("Yielding web search raw response message: ", message)
                        yield ('message', message)

                continue

            # Update current agent when it changes
            elif event.type == "agent_updated_stream_event":
                if current_agent.name == event.new_agent.name:
                    continue

                tool_call_id = str(uuid.uuid4())

                # yield the transfer invocation
                message = {
                    'content': None,
                    'role': 'assistant',
                    'sender': current_agent.name,
                    'tool_calls': [{
                        'function': {
                            'name': 'transfer_to_agent',
                            'arguments': json.dumps({
                                'assistant': event.new_agent.name
                            })
                        },
                        'id': tool_call_id,
                        'type': 'function'
                    }],
                    'tool_call_id': None,
                    'tool_name': None,
                    'response_type': 'internal'
                }
                print("Yielding message: ", message)
                yield ('message', message)

                # yield the transfer result
                message = {
                    'content': json.dumps({
                        'assistant': event.new_agent.name
                    }),
                    'role': 'tool',
                    'sender': None,
                    'tool_calls': None,
                    'tool_call_id': tool_call_id,
                    'tool_name': 'transfer_to_agent',
                }
                print("Yielding message: ", message)
                yield ('message', message)

                current_agent = event.new_agent
                continue

            # Handle run items (tools, messages, etc)
            elif event.type == "run_item_stream_event":
                current_agent = event.item.agent
                if event.item.type == "tool_call_item":
                    # Check if it's a ResponseFunctionWebSearch object
                    if hasattr(event.item.raw_item, 'type') and event.item.raw_item.type == 'web_search_call':
                        call_id = event.item.raw_item.id if hasattr(event.item.raw_item, 'id') else str(uuid.uuid4())
                        message = {
                            'content': None,
                            'role': 'assistant',
                            'sender': current_agent.name if current_agent else None,
                            'tool_calls': [{
                                'function': {
                                    'name': 'web_search',
                                    'arguments': json.dumps({
                                        'search_id': call_id
                                    })
                                },
                                'id': call_id,
                                'type': 'function'
                            }],
                            'tool_call_id': None,
                            'tool_name': None,
                            'response_type': 'internal'
                        }
                        print("Yielding message: ", message)
                        yield ('message', message)

                        result_message = {
                        'content': "Web search done",
                        'role': 'tool',
                        'sender': None,
                        'tool_calls': None,
                        'tool_call_id': call_id,
                        'tool_name': 'web_search',
                        'response_type': 'internal'
                        }

                        print("Yielding web search results: ", result_message)
                        yield ('message', result_message)
                    else:
                        # Handle normal tool calls
                        message = {
                            'content': None,
                            'role': 'assistant',
                            'sender': current_agent.name if current_agent else None,
                            'tool_calls': [{
                                'function': {
                                    'name': event.item.raw_item.name,
                                    'arguments': event.item.raw_item.arguments
                                },
                                'id': event.item.raw_item.call_id,
                                'type': 'function'
                            }],
                            'tool_call_id': None,
                            'tool_name': None,
                            'response_type': 'internal'
                        }
                        print("Yielding message: ", message)
                        yield ('message', message)


                elif event.item.type == "tool_call_output_item":
                    # Check if it's a web search result
                    if isinstance(event.item.raw_item, dict) and event.item.raw_item.get('type') == 'web_search_results':
                        call_id = event.item.raw_item.get('search_id', event.item.raw_item.get('id', str(uuid.uuid4())))
                        message = {
                            'content': str(event.item.output),
                            'role': 'tool',
                            'sender': None,
                            'tool_calls': None,
                            'tool_call_id': call_id,
                            'tool_name': 'web_search',
                            'response_type': 'internal'
                        }
                    else:
                        # Safe extraction of call_id and name
                        call_id = None
                        tool_name = None

                        # Handle different types of raw_item
                        if isinstance(event.item.raw_item, dict):
                            call_id = event.item.raw_item.get('call_id')
                            tool_name = event.item.raw_item.get('name')
                        elif hasattr(event.item.raw_item, 'call_id'):
                            call_id = event.item.raw_item.call_id
                            if hasattr(event.item.raw_item, 'name'):
                                tool_name = event.item.raw_item.name

                        message = {
                            'content': str(event.item.output),
                            'role': 'tool',
                            'sender': None,
                            'tool_calls': None,
                            'tool_call_id': call_id,
                            'tool_name': tool_name,
                            'response_type': 'internal'
                        }

                    print("Yielding message: ", message)
                    yield ('message', message)

                elif event.item.type == "message_output_item":
                    content = ""
                    url_citations = []

                    # Extract text content and any URL citations
                    if hasattr(event.item.raw_item, 'content'):
                        for content_item in event.item.raw_item.content:
                            # Handle text content
                            if hasattr(content_item, 'text'):
                                content += content_item.text

                            # Extract URL citations if present
                            if hasattr(content_item, 'annotations'):
                                for annotation in content_item.annotations:
                                    if hasattr(annotation, 'type') and annotation.type == 'url_citation':
                                        citation = {
                                            'url': annotation.url if hasattr(annotation, 'url') else '',
                                            'title': annotation.title if hasattr(annotation, 'title') else '',
                                            'start_index': annotation.start_index if hasattr(annotation, 'start_index') else 0,
                                            'end_index': annotation.end_index if hasattr(annotation, 'end_index') else 0
                                        }
                                        url_citations.append(citation)

                    # Create message with URL citations if they exist
                    message = {
                        'content': content,
                        'role': 'assistant',
                        'sender': current_agent.name,
                        'tool_calls': None,
                        'tool_call_id': None,
                        'tool_name': None,
                        'response_type': 'external'
                    }

                    # Add citations if any were found
                    if url_citations:
                        message['citations'] = url_citations

                    print("Yielding message: ", message)
                    yield ('message', message)

                # Handle web search function call events
                elif event.item.type == "web_search_call_item" or (hasattr(event.item, 'raw_item') and hasattr(event.item.raw_item, 'type') and event.item.raw_item.type == 'web_search_call'):
                    # Extract web search call ID if available
                    call_id = None
                    if hasattr(event.item.raw_item, 'id'):
                        call_id = event.item.raw_item.id

                    message = {
                        'content': None,
                        'role': 'assistant',
                        'sender': current_agent.name if current_agent else None,
                        'tool_calls': [{
                            'function': {
                                'name': 'web_search',
                                'arguments': json.dumps({
                                    'search_id': call_id
                                })
                            },
                            'id': call_id or str(uuid.uuid4()),
                            'type': 'function'
                        }],
                        'tool_call_id': None,
                        'tool_name': None,
                        'response_type': 'internal'
                    }
                    print("Yielding web search message: ", message)
                    yield ('message', message)

                # Handle web search results
                elif event.item.type == "web_search_results_item" or (
                    hasattr(event.item, 'raw_item') and (
                        (hasattr(event.item.raw_item, 'type') and event.item.raw_item.type == 'web_search_results') or
                        (isinstance(event.item.raw_item, dict) and event.item.raw_item.get('type') == 'web_search_results')
                    )
                ):
                    # Extract call_id safely
                    call_id = None
                    raw_item = event.item.raw_item

                    # Try several ways to get the search_id or id
                    if hasattr(raw_item, 'search_id'):
                        call_id = raw_item.search_id
                    elif isinstance(raw_item, dict) and 'search_id' in raw_item:
                        call_id = raw_item['search_id']
                    elif hasattr(raw_item, 'id'):
                        call_id = raw_item.id
                    elif isinstance(raw_item, dict) and 'id' in raw_item:
                        call_id = raw_item['id']
                    else:
                        call_id = str(uuid.uuid4())

                    # Extract results content safely
                    results = {}

                    # Try event.item.output first
                    if hasattr(event.item, 'output'):
                        results = event.item.output
                    # Then try raw_item.results
                    elif hasattr(raw_item, 'results'):
                        results = raw_item.results
                    elif isinstance(raw_item, dict) and 'results' in raw_item:
                        results = raw_item['results']

                    # Format the results for output
                    results_str = ""
                    try:
                        results_str = json.dumps(results) if results else ""
                    except Exception as e:
                        print(f"Error serializing results: {str(e)}")
                        results_str = str(results)

                    message = {
                        'content': results_str,
                        'role': 'tool',
                        'sender': None,
                        'tool_calls': None,
                        'tool_call_id': call_id,
                        'tool_name': 'web_search',
                        'response_type': 'internal'
                    }
                    print("Yielding web search results: ", message)
                    yield ('message', message)

            print(f"\n{'='*50}\n")

        # After all events are processed, set final state
        final_state = {
            "last_agent_name": current_agent.name if current_agent else None,
            "tokens": tokens_used
        }
        yield ('done', {'state': final_state})

    except Exception as e:
        print(traceback.format_exc())
        print(f"Error in stream processing: {str(e)}")
        print("Yielding error event:", {'error': str(e), 'state': final_state})
        yield ('error', {'error': str(e), 'state': final_state})  # Include final_state in error response