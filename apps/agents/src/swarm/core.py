# Standard library imports
import copy
import json
from collections import defaultdict
from typing import List, Callable, Union
from datetime import datetime

# Package/library imports
from openai import OpenAI
import random

# Local imports
from .util import *
from .types import (
    Agent,
    AgentFunction,
    ChatCompletionMessage,
    ChatCompletionMessageToolCall,
    Function,
    Response,
    Result,
)

__CTX_VARS_NAME__ = "context_variables"


class Swarm:
    def __init__(self, client=None):
        if not client:
            client = OpenAI(api_key=OPENAI_API_KEY)
        self.client = client
        self.history = defaultdict(lambda : [])

    def get_chat_completion(
        self,
        agent: Agent,
        history: List,
        context_variables: dict,
        model_override: str,
        stream: bool,
        debug: bool,
        temperature: float
    ) -> ChatCompletionMessage:
        context_variables = defaultdict(str, context_variables)
        instructions = (
            agent.instructions(context_variables)
            if callable(agent.instructions)
            else agent.instructions
        )
        messages = [{"role": "system", "content": instructions}] + history
        debug_print(debug, "Getting chat completion for...:", messages)

        all_functions = list(agent.child_functions.values()) + ([agent.parent_function] if agent.parent_function else [])
        all_tools = agent.external_tools + agent.internal_tools
        funcs_and_tools = [function_to_json(f) for f in all_functions] + [t for t in all_tools]
        # hide context_variables from model
        for tool in funcs_and_tools:
            params = tool["function"]["parameters"]
            params["properties"].pop(__CTX_VARS_NAME__, None)
            if __CTX_VARS_NAME__ in params.get("required", []):
                params["required"].remove(__CTX_VARS_NAME__)

        create_params = {
            "model": model_override or agent.model,
            "messages": messages,
            "tools": funcs_and_tools or None,
            "tool_choice": agent.tool_choice,
            "stream": stream,
            "temperature": temperature
        }

        if funcs_and_tools:
            create_params["parallel_tool_calls"] = agent.parallel_tool_calls

        return self.client.chat.completions.create(**create_params)

    def handle_function_result(self, result, debug) -> Result:
        # Check if result is already a Result instance
        if isinstance(result, Result):
            return result
        
        # Check if result is an Agent instance
        if isinstance(result, Agent):
            return Result(
                value=json.dumps({"assistant": result.name}),
                agent=result,
            )
        
        # Handle all other cases
        try:
            return Result(value=str(result))
        except Exception as e:
            error_message = f"Failed to cast response to string: {result}. Make sure agent functions return a string or Result object. Error: {str(e)}"
            debug_print(debug, error_message)
            raise TypeError(error_message)

    def handle_function_calls(
        self,
        tool_calls: List[ChatCompletionMessageToolCall],
        functions: List[AgentFunction],
        context_variables: dict,
        debug: bool,
    ) -> Response:
        function_map = {f.__name__: f for f in functions}
        partial_response = Response(
            messages=[], agent=None, context_variables={})

        for tool_call in tool_calls:
            name = tool_call.function.name
            # handle missing tool case, skip to next tool
            if name not in function_map:
                debug_print(debug, f"Tool {name} not found in function map.")
                partial_response.messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "tool_name": name,
                        "content": f"Error: Tool {name} not found.",
                    }
                )
                continue
            args = json.loads(tool_call.function.arguments)
            debug_print(
                debug, f"Processing tool call: {name} with arguments {args}")

            func = function_map[name]
            # pass context_variables to agent functions
            if __CTX_VARS_NAME__ in func.__code__.co_varnames:
                args[__CTX_VARS_NAME__] = context_variables
            raw_result = function_map[name](**args)

            result: Result = self.handle_function_result(raw_result, debug)
            partial_response.messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "tool_name": name,
                    "content": result.value,
                }
            )
            partial_response.context_variables.update(result.context_variables)
            if result.agent:
                partial_response.agent = result.agent

        return partial_response
    
    def run(
        self,
        agent: Agent,
        messages: List,
        context_variables: dict = {},
        model_override: str = None,
        stream: bool = False,
        debug: bool = False,
        max_messages_per_turn: int = 10,
        execute_tools: bool = True,
        external_tools: List[str] = [],
        localize_history: bool = True,
        parent_has_child_history: bool = True,
        tokens_used: dict = {},
        temperature: float = 0.0
    ) -> Response:

        active_agent = agent
        context_variables = copy.deepcopy(context_variables)
        global_history = copy.deepcopy(messages)
        init_len = len(messages)
        
        while len(global_history) - init_len < max_messages_per_turn and active_agent:                    
            history = active_agent.history if localize_history else global_history
            history = arrange_messages_keys_in_order(history)

            parent = active_agent.most_recent_parent
            
            children_names_backup, children_backup, child_functions_backup = copy.deepcopy(active_agent.children_names), copy.deepcopy(active_agent.children), copy.deepcopy(active_agent.child_functions)

            active_agent = check_and_remove_repeat_tool_call_to_child(active_agent, history)

            # get completion with current history, agent
            completion = self.get_chat_completion(
                agent=active_agent,
                history=history,
                context_variables=context_variables,
                model_override=model_override,
                stream=stream,
                debug=debug,
                temperature=temperature
            )
            tokens_used = update_tokens_used(provider="openai", model=model_override or active_agent.model, tokens_used=tokens_used, completion=completion)

            # Restore children and child functions
            active_agent.children_names, active_agent.children, active_agent.child_functions = children_names_backup, children_backup, child_functions_backup
        
            message = completion.choices[0].message
            debug_print(debug, "Received completion:", message)
            message.sender = active_agent.name
            message_json = json.loads(message.model_dump_json())
            message_json = add_message_metadata(message_json, active_agent)
        
            if localize_history:
                active_agent = update_histories(active_agent, message_json)
                if parent and parent_has_child_history:
                    parent = update_histories(parent, message_json)
            global_history.append(message_json)
            
            external_tool_calls = []
            internal_tool_calls = []
            
            if message.tool_calls:
                message_json["response_type"] = "internal"
                for tool_call in message.tool_calls:
                    tool_name = tool_call.function.name
                    if tool_name in external_tools:
                        external_tool_calls.append(tool_call)
                    else:
                        internal_tool_calls.append(tool_call)
                message.tool_calls = internal_tool_calls

            if not message.tool_calls or not execute_tools:
                if external_tool_calls:
                    message.tool_calls.extend(external_tool_calls)
                debug_print(debug, "Ending turn.")
                break

            # handle function calls, updating context_variables, and switching agents
            all_functions = list(active_agent.child_functions.values()) + ([active_agent.parent_function] if active_agent.parent_function else [])
            partial_response = self.handle_function_calls(
                message.tool_calls, all_functions, context_variables, debug
            )
            for msg in partial_response.messages:
                msg = add_message_metadata(msg, active_agent)
                if localize_history:
                    active_agent = update_histories(active_agent, msg)
                    if parent and parent_has_child_history:
                        parent = update_histories(parent, msg)
            
            global_history.extend(partial_response.messages)
            context_variables.update(partial_response.context_variables)
            
            # Parent to child transfer
            if partial_response.agent:
                prev_agent = active_agent
                active_agent = partial_response.agent

                # Parent to child transfer
                if active_agent.name in prev_agent.children_names:
                    active_agent.most_recent_parent = prev_agent
                    active_agent.parent_function = active_agent.candidate_parent_functions[active_agent.most_recent_parent.name]
                    if localize_history:
                        if not parent_has_child_history:
                            prev_agent.history = remove_irrelevant_messages(prev_agent.history)
                        new_active_agent_history = get_current_turn_messages(global_history, only_user = True)
                        active_agent.history.extend(new_active_agent_history)
                
                # Child to parent transfer
                else:
                    assert parent == active_agent, "Parent and active agent do not match when active agent is not a child of previous agent"
                    child = prev_agent
                    if localize_history:
                        child.history = remove_irrelevant_messages(child.history)
                

        return_messages = global_history[init_len:]
        error_msg = ""

        if len(global_history) - init_len >= max_messages_per_turn:
            error_msg = "Max messages per turn reached"
        
        return Response(
            messages=return_messages,
            agent=active_agent,
            context_variables=context_variables,
            error_msg=error_msg,
            tokens_used=tokens_used
        )
