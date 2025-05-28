import traceback
from copy import deepcopy
from datetime import datetime
import json
import uuid
import logging
from .helpers.access import (
    get_agent_by_name,
    get_external_tools,
    get_prompt_by_type,
    get_agent_config_by_name
)
from .helpers.library_tools import handle_web_search_event
from .helpers.control import get_last_agent_name
from .execute_turn import run_streamed as swarm_run_streamed, get_agents
from .helpers.instructions import add_child_transfer_related_instructions
from .types import PromptType, outputVisibility, ResponseType
from agents.extensions.handoff_prompt import RECOMMENDED_PROMPT_PREFIX


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

    return messages

def add_child_transfer_related_instructions_to_agents(agents):
    for agent in agents:
        add_child_transfer_related_instructions(agent)
    return agents

def add_openai_recommended_instructions_to_agents(agents):
    for agent in agents:
        agent.instructions = RECOMMENDED_PROMPT_PREFIX + '\n\n' + agent.instructions
    return agents

def check_internal_visibility(current_agent):
    """Check if an agent is internal based on its outputVisibility"""
    return current_agent.output_visibility == outputVisibility.INTERNAL.value

def add_sender_details_to_messages(messages):
    for msg in messages:
        msg['sender'] = msg.get('sender', None)
        if msg.get('sender'):
            msg['content'] = f"Sender agent: {msg.get('sender')}\nContent: {msg.get('content')}"
    return messages

def append_messages(messages, accumulated_messages):
    # Create a set of existing message contents for O(1) lookup
    existing_contents = {msg.get('content') for msg in messages}

    # Append messages that aren't already present, preserving order
    for msg in accumulated_messages:
        if msg.get('content') not in existing_contents:
            messages.append(msg)
            existing_contents.add(msg.get('content'))

    return messages

async def run_turn_streamed(
    messages,
    start_agent_name,
    agent_configs,
    tool_configs,
    prompt_configs,
    start_turn_with_start_agent,
    state={},
    complete_request={},
    enable_tracing=None
):
    """
    Run a turn of the conversation with streaming responses.

    A turn consists of all messages between user inputs and must follow these rules:
    1. Each turn must have exactly one external message from an agent with external visibility
    2. A turn can have multiple internal messages from internal agents
    3. Each agent can output at most one regular message per parent
    4. Control flows from parent to child, and child must return to parent after responding
    5. Turn ends when an external agent outputs a message
    """
    print("\n=== Starting new turn ===")
    print(f"Starting agent: {start_agent_name}")

    # Use enable_tracing from complete_request if available, otherwise default to False
    enable_tracing = complete_request.get("enable_tracing", False) if enable_tracing is None else enable_tracing

    messages = set_sys_message(messages)
    messages = add_sender_details_to_messages(messages)
    is_greeting_turn = not any(msg.get("role") != "system" for msg in messages)
    final_state = None
    accumulated_messages = []
    agent_message_counts = {}  # Track messages per agent
    child_call_counts = {}  # Track parent->child calls
    current_agent = None
    parent_stack = []

    try:
        # Handle greeting turn
        if is_greeting_turn:
            greeting_prompt = get_prompt_by_type(prompt_configs, PromptType.GREETING) or "How can I help you today?"
            message = {
                'content': greeting_prompt,
                'role': 'assistant',
                'sender': start_agent_name,
                'tool_calls': None,
                'tool_call_id': None,
                'tool_name': None,
                'response_type': ResponseType.EXTERNAL.value
            }
            accumulated_messages.append(message)
            print('-'*100)
            print(f"Yielding message: {message}")
            print('-'*100)
            yield ('message', message)
            final_state = {
                "last_agent_name": start_agent_name,
                "tokens": {"total": 0, "prompt": 0, "completion": 0},
                "turn_messages": accumulated_messages
            }
            print('-'*100)
            print(f"Yielding done: {final_state}")
            print('-'*100)
            yield ('done', {'state': final_state})
            return

        # Initialize agents and get external tools

        new_agents = get_agents(
            agent_configs=agent_configs,
            tool_configs=tool_configs,
            complete_request=complete_request
        )
        new_agents = add_child_transfer_related_instructions_to_agents(new_agents)
        new_agents = add_openai_recommended_instructions_to_agents(new_agents)
        last_agent_name = get_last_agent_name(
            state=state,
            agent_configs=agent_configs,
            start_agent_name=start_agent_name,
            msg_type="user",
            latest_assistant_msg=None,
            start_turn_with_start_agent=start_turn_with_start_agent
        )
        current_agent = get_agent_by_name(last_agent_name, new_agents)
        external_tools = get_external_tools(tool_configs)
        tokens_used = {"total": 0, "prompt": 0, "completion": 0}
        iter = 0
        while True:
            iter += 1
            is_internal_agent = check_internal_visibility(current_agent)
            print('-'*100)
            print(f"Iteration {iter} of turn loop")
            print(f"Current agent: {current_agent.name} (internal: {is_internal_agent})")
            print(f"Parent stack: {[agent.name for agent in parent_stack]}")
            print('-'*100)

            messages = append_messages(messages, accumulated_messages)
            # Run the current agent
            stream_result = await swarm_run_streamed(
                agent=current_agent,
                messages=messages,
                external_tools=external_tools,
                tokens_used=tokens_used,
                enable_tracing=enable_tracing
            )

            async for event in stream_result.stream_events():
                try:
                    # Handle web search events
                    if event.type == "raw_response_event":
                        # Handle token usage counting
                        if hasattr(event.data, 'type') and event.data.type == "response.completed" and hasattr(event.data.response, 'usage'):
                            try:
                                tokens_used["total"] += event.data.response.usage.total_tokens
                                tokens_used["prompt"] += event.data.response.usage.input_tokens
                                tokens_used["completion"] += event.data.response.usage.output_tokens
                                print('-'*50)
                                print(f"Found usage information. Updated cumulative tokens: {tokens_used}")
                                print('-'*50)
                            except Exception as e:
                                print(f"Warning: Tokens used is likely not available for your chosen model: {e}")

                        web_search_messages = handle_web_search_event(event, current_agent)
                        for message in web_search_messages:
                            message['response_type'] = ResponseType.INTERNAL.value
                            print('-'*100)
                            print(f"Yielding message: {message}")
                            print('-'*100)
                            yield ('message', message)
                            if message.get('role') != 'tool':
                                message['content'] = f"Sender agent: {current_agent.name}\nContent: {message['content']}"
                                accumulated_messages.append(message)
                        continue

                    # Handle agent transfer
                    elif event.type == "agent_updated_stream_event":

                        # Skip self-transfers
                        if current_agent.name == event.new_agent.name:
                            print(f"\nSkipping agent transfer attempt: {current_agent.name} -> {event.new_agent.name} (self-transfer)")
                            continue

                        # Check if we've already called this child agent too many times
                        parent_child_key = f"{current_agent.name}:{event.new_agent.name}"
                        current_count = child_call_counts.get(parent_child_key, 0)
                        if current_count >= event.new_agent.max_calls_per_parent_agent:
                            print(f"Skipping transfer from {current_agent.name} to {event.new_agent.name} (max calls reached from parent to child)")
                            continue

                        # Transfer to new agent
                        tool_call_id = str(uuid.uuid4())
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
                            'response_type': ResponseType.INTERNAL.value
                        }
                        print('-'*100)
                        print(f"Yielding message: {message}")
                        print('-'*100)
                        yield ('message', message)

                        # Record transfer result
                        message = {
                            'content': json.dumps({
                                'assistant': event.new_agent.name
                            }),
                            'role': 'tool',
                            'sender': None,
                            'tool_calls': None,
                            'tool_call_id': tool_call_id,
                            'tool_name': 'transfer_to_agent'
                        }
                        print('-'*100)
                        print(f"Yielding message: {message}")
                        print('-'*100)
                        yield ('message', message)

                        # Update tracking and switch to child
                        if check_internal_visibility(event.new_agent):
                            child_call_counts[parent_child_key] = current_count + 1
                            parent_stack.append(current_agent)
                        current_agent = event.new_agent

                    # Handle regular messages and tool calls
                    elif event.type == "run_item_stream_event":
                        if event.item.type == "tool_call_item":
                            # Check if it's a web search call
                            if hasattr(event.item.raw_item, 'type') and event.item.raw_item.type == 'web_search_call':
                                web_search_messages = handle_web_search_event(event, current_agent)
                                for message in web_search_messages:
                                    message['response_type'] = ResponseType.INTERNAL.value
                                    print('-'*100)
                                    print(f"Yielding message: {message}")
                                    print('-'*100)
                                    yield ('message', message)
                                    if message.get('role') != 'tool':
                                        message['content'] = f"Sender agent: {current_agent.name}\nContent: {message['content']}"
                                        accumulated_messages.append(message)
                                continue

                            # Handle regular tool calls
                            message = {
                                'content': None,
                                'role': 'assistant',
                                'sender': current_agent.name,
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
                                'response_type': ResponseType.INTERNAL.value
                            }
                            print('-'*100)
                            print(f"Yielding message: {message}")
                            print('-'*100)
                            yield ('message', message)
                            message['content'] = f"Sender agent: {current_agent.name}\nContent: {message['content']}"
                            accumulated_messages.append(message)

                        elif event.item.type == "tool_call_output_item":
                            # Get the tool name and call id from raw_item
                            tool_call_id = None
                            tool_name = None

                            # Try to get call_id from various possible locations
                            if hasattr(event.item.raw_item, 'call_id'):
                                tool_call_id = event.item.raw_item.call_id
                            elif isinstance(event.item.raw_item, dict) and 'call_id' in event.item.raw_item:
                                tool_call_id = event.item.raw_item['call_id']

                            # Try to get tool name from various possible locations
                            if hasattr(event.item.raw_item, 'name'):
                                tool_name = event.item.raw_item.name
                            elif isinstance(event.item.raw_item, dict):
                                if 'name' in event.item.raw_item:
                                    tool_name = event.item.raw_item['name']
                                elif 'type' in event.item.raw_item and event.item.raw_item['type'] == 'function_call_output':
                                    # For function call outputs, try to infer from context
                                    tool_name = 'recommendation'  # Default for function calls

                            # Fallback to event item if available
                            if not tool_name and hasattr(event.item, 'tool_name'):
                                tool_name = event.item.tool_name
                            if not tool_call_id and hasattr(event.item, 'tool_call_id'):
                                tool_call_id = event.item.tool_call_id

                            message = {
                                'content': str(event.item.output),
                                'role': 'tool',
                                'sender': None,
                                'tool_calls': None,
                                'tool_call_id': tool_call_id,
                                'tool_name': tool_name,
                                'response_type': ResponseType.INTERNAL.value
                            }
                            print('-'*100)
                            print(f"Yielding tool call output message: {message}")
                            print('-'*100)
                            yield ('message', message)

                        elif event.item.type == "message_output_item":
                            # Extract content and citations
                            content = ""
                            url_citations = []
                            if hasattr(event.item.raw_item, 'content'):
                                for content_item in event.item.raw_item.content:
                                    if hasattr(content_item, 'text'):
                                        content += content_item.text
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

                            # Determine message type and create message
                            is_internal = check_internal_visibility(current_agent)
                            response_type = ResponseType.INTERNAL.value if is_internal else ResponseType.EXTERNAL.value

                            message = {
                                'content': content,
                                'role': 'assistant',
                                'sender': current_agent.name,
                                'tool_calls': None,
                                'tool_call_id': None,
                                'tool_name': None,
                                'response_type': response_type
                            }

                            if url_citations:
                                message['citations'] = url_citations

                            # Track that this agent has responded
                            if not message.get('tool_calls'):  # If there are no tool calls, it's a content response
                                agent_message_counts[current_agent.name] = 1
                            print('-'*100)
                            print(f"Yielding message: {message}")
                            print('-'*100)
                            yield ('message', message)
                            message['content'] = f"Sender agent: {current_agent.name}\nContent: {message['content']}"
                            accumulated_messages.append(message)
                            # Return to parent or end turn
                            if is_internal and parent_stack:
                                # Create tool call for control transition
                                tool_call_id = str(uuid.uuid4())
                                transition_message = {
                                    'content': None,
                                    'role': 'assistant',
                                    'sender': current_agent.name,
                                    'tool_calls': [{
                                        'function': {
                                            'name': 'transfer_to_agent',
                                            'arguments': json.dumps({
                                                'assistant': parent_stack[-1].name
                                            })
                                        },
                                        'id': tool_call_id,
                                        'type': 'function'
                                    }],
                                    'tool_call_id': None,
                                    'tool_name': None,
                                    'response_type': ResponseType.INTERNAL.value
                                }
                                print('-'*100)
                                print(f"Yielding control transition message: {transition_message}")
                                print('-'*100)
                                yield ('message', transition_message)

                                # Create tool response for control transition
                                transition_response = {
                                    'content': json.dumps({
                                        'assistant': parent_stack[-1].name
                                    }),
                                    'role': 'tool',
                                    'sender': None,
                                    'tool_calls': None,
                                    'tool_call_id': tool_call_id,
                                    'tool_name': 'transfer_to_agent'
                                }
                                print('-'*100)
                                print(f"Yielding control transition response: {transition_response}")
                                print('-'*100)
                                yield ('message', transition_response)

                                current_agent = parent_stack.pop()
                                continue
                            elif not is_internal:
                                break

                except Exception as e:
                    print("\n=== Error in stream event processing ===")
                    print(f"Error: {str(e)}")
                    print("Event details:")
                    print(f"Event type: {event.type if hasattr(event, 'type') else 'unknown'}")
                    if hasattr(event, '__dict__'):
                        print(f"Event attributes: {event.__dict__}")
                    print(f"Full event object: {event}")
                    print(f"Traceback: {traceback.format_exc()}")
                    print("=" * 50)
                    raise

            # Break main loop if we've output an external message
            if not is_internal_agent and current_agent.name in agent_message_counts:
                break

        # Set final state
        final_state = {
            "last_agent_name": current_agent.name if current_agent else None,
            "tokens": tokens_used,
            "turn_messages": accumulated_messages
        }
        print('-'*100)
        print(f"Yielding done: {final_state}")
        print('-'*100)
        yield ('done', {'state': final_state})

    except Exception as e:
        print(traceback.format_exc())
        print(f"Error in stream processing: {str(e)}")
        yield ('error', {'error': str(e), 'state': final_state})