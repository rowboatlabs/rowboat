import json
import uuid
import traceback

def handle_web_search_event(event, current_agent):
    """
    Helper function to handle all web search related events.
    Returns a list of messages to yield.
    """
    messages = []
    
    try:
        # Handle raw response web search
        if event.type == "raw_response_event":
            if hasattr(event, 'data') and hasattr(event.data, 'raw_item'):
                raw_item = event.data.raw_item
                if (hasattr(raw_item, 'type') and raw_item.type == 'web_search_call') or (
                    isinstance(raw_item, dict) and raw_item.get('type') == 'web_search_call'
                ):
                    call_id = None
                    if hasattr(raw_item, 'id'):
                        call_id = raw_item.id
                    elif isinstance(raw_item, dict) and 'id' in raw_item:
                        call_id = raw_item['id']
                    else:
                        call_id = str(uuid.uuid4())

                    status = 'unknown'
                    if hasattr(raw_item, 'status'):
                        status = raw_item.status
                    elif isinstance(raw_item, dict) and 'status' in raw_item:
                        status = raw_item['status']
                    tool_call_msg = {
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
                    print(f"Condition for tool call matched in raw_response_event. Appending tool call message: {tool_call_msg}")
                    messages.append(tool_call_msg)

                    tool_call_output_dummy_msg = {
                        'content': 'Web search completed.',
                        'role': 'tool',
                        'sender': None,
                        'tool_calls': None,
                        'tool_call_id': call_id,
                        'tool_name': 'web_search',
                        'response_type': 'internal'
                    }
                    messages.append(tool_call_output_dummy_msg)

        # Handle run item web search events
        elif event.type == "run_item_stream_event":
            if event.item.type == "tool_call_item":
                try:
                    # Check if it's a web search call
                    if hasattr(event.item.raw_item, 'type') and event.item.raw_item.type == 'web_search_call':
                        call_id = event.item.raw_item.id if hasattr(event.item.raw_item, 'id') else str(uuid.uuid4())
                        tool_call_msg = {
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
                        print(f"Condition for tool call matched in run_item_stream_event. Appending tool call message: {tool_call_msg}")
                        messages.append(tool_call_msg)

                        tool_call_output_dummy_msg = {
                            'content': 'Web search completed.',
                            'role': 'tool',
                            'sender': None,
                            'tool_calls': None,
                            'tool_call_id': call_id,
                            'tool_name': 'web_search',
                            'response_type': 'internal'
                        }
                        messages.append(tool_call_output_dummy_msg)
                    else:
                        # Handle regular tool calls
                        tool_call_msg = {
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
                        print(f"Condition for tool call matched in run_item_stream_event. Appending tool call message: {tool_call_msg}")
                        messages.append(tool_call_msg)

                        tool_call_output_dummy_msg = {
                            'content': 'Web search completed.',
                            'role': 'tool',
                            'sender': None,
                            'tool_calls': None,
                            'tool_call_id': call_id,
                            'tool_name': 'web_search',
                            'response_type': 'internal'
                        }
                        messages.append(tool_call_output_dummy_msg)
                except Exception as e:
                    print("\n=== Error in tool_call_item handling ===")
                    print(f"Error: {str(e)}")
                    print(f"Event type: {event.type}")
                    print(f"Event item type: {event.item.type}")
                    print("Event details:")
                    print(f"Raw item: {event.item.raw_item}")
                    if hasattr(event.item.raw_item, '__dict__'):
                        print(f"Raw item attributes: {event.item.raw_item.__dict__}")
                    print(f"Traceback: {traceback.format_exc()}")
                    print("=" * 50)
                    raise

            elif event.item.type == "tool_call_output_item":
                if isinstance(event.item.raw_item, dict) and event.item.raw_item.get('type') == 'web_search_results':
                    call_id = event.item.raw_item.get('search_id', event.item.raw_item.get('id', str(uuid.uuid4())))
                    tool_call_output_msg = {
                        'content': str(event.item.output),
                        'role': 'tool',
                        'sender': None,
                        'tool_calls': None,
                        'tool_call_id': call_id,
                        'tool_name': 'web_search',
                        'response_type': 'internal'
                    }
                    print(f"Condition for tool call output matched in run_item_stream_event. Appending tool call output message: {tool_call_output_msg}")
                    messages.append(tool_call_output_msg)

            elif event.item.type == "web_search_call_item" or (
                hasattr(event.item, 'raw_item') and 
                hasattr(event.item.raw_item, 'type') and 
                event.item.raw_item.type == 'web_search_call'
            ):
                call_id = None
                if hasattr(event.item.raw_item, 'id'):
                    call_id = event.item.raw_item.id
                tool_call_msg = {
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
                print(f"Condition for tool call matched in run_item_stream_event. Appending tool call message: {tool_call_msg}")
                messages.append(tool_call_msg)
                tool_call_output_dummy_msg = {
                    'content': 'Web search completed.',
                    'role': 'tool',
                    'sender': None,
                    'tool_calls': None,
                    'tool_call_id': call_id,
                    'tool_name': 'web_search',
                    'response_type': 'internal'
                }
                messages.append(tool_call_output_dummy_msg)

            elif event.item.type == "web_search_results_item" or (
                hasattr(event.item, 'raw_item') and (
                    (hasattr(event.item.raw_item, 'type') and event.item.raw_item.type == 'web_search_results') or
                    (isinstance(event.item.raw_item, dict) and event.item.raw_item.get('type') == 'web_search_results')
                )
            ):
                raw_item = event.item.raw_item
                call_id = None

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

                results = {}
                if hasattr(event.item, 'output'):
                    results = event.item.output
                elif hasattr(raw_item, 'results'):
                    results = raw_item.results
                elif isinstance(raw_item, dict) and 'results' in raw_item:
                    results = raw_item['results']

                results_str = ""
                try:
                    results_str = json.dumps(results) if results else ""
                except Exception as e:
                    print(f"Error serializing results: {str(e)}")
                    results_str = str(results)

                tool_call_output_msg = {
                    'content': results_str,
                    'role': 'tool',
                    'sender': None,
                    'tool_calls': None,
                    'tool_call_id': call_id,
                    'tool_name': 'web_search',
                    'response_type': 'internal'
                }
                print(f"Condition for tool call output matched in run_item_stream_event. Appending tool call output message: {tool_call_output_msg}")
                messages.append(tool_call_output_msg)

    except Exception as e:
        print("\n=== Error in handle_web_search_event ===")
        print(f"Error: {str(e)}")
        print(f"Event type: {event.type}")
        if hasattr(event, 'item'):
            print(f"Event item type: {event.item.type}")
            print("Event item details:")
            print(f"Raw item: {event.item.raw_item}")
            if hasattr(event.item.raw_item, '__dict__'):
                print(f"Raw item attributes: {event.item.raw_item.__dict__}")
        print(f"Traceback: {traceback.format_exc()}")
        print("=" * 50)
        raise

    if messages:
        print("-"*100)
        print(f"Web search related messages: {messages}")
        print("-"*100)

    return messages
