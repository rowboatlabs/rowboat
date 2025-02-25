from typing import Dict, List, Optional, Any, Callable, Union, Tuple
import requests
import json
from .schema import (
    ApiRequest, 
    ApiResponse, 
    ApiMessage, 
    ToolMessage, 
    UserMessage, 
    SystemMessage, 
    AssistantMessage, 
    AssistantMessageWithToolCalls
)


class Client:
    def __init__(self, host: str, project_id: str, api_key: str) -> None:
        self.base_url: str = f'{host}/api/v1/{project_id}/chat'
        self.headers: Dict[str, str] = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}'
        }

    def _call_api(
        self, 
        messages: List[ApiMessage],
        state: Optional[Dict[str, Any]] = None,
        skip_tool_calls: bool = False,
        max_turns: int = 3,
        workflow_id: Optional[str] = None,
        test_profile_id: Optional[str] = None
    ) -> ApiResponse:
        request = ApiRequest(
            messages=messages,
            state=state,
            skipToolCalls=skip_tool_calls,
            maxTurns=max_turns,
            workflowId=workflow_id,
            testProfileId=test_profile_id
        )
        json_data = request.model_dump()
        response = requests.post(self.base_url, headers=self.headers, json=json_data)

        if not response.status_code == 200:
            raise ValueError(f"Error: {response.status_code} - {response.text}")
    
        response_data = ApiResponse.model_validate(response.json())
        
        if not response_data.messages:
            raise ValueError("No response")
            
        last_message = response_data.messages[-1]
        if not isinstance(last_message, (AssistantMessage, AssistantMessageWithToolCalls)):
            raise ValueError("Last message was not an assistant message")

        return response_data

    def _process_tool_calls(
        self,
        tool_calls: List[Any],
        tools: Dict[str, Callable[..., str]]
    ) -> List[ToolMessage]:
        """Process tool calls and return a list of tool response messages"""
        tool_messages = []
        for tool_call in tool_calls:
            tool_name = tool_call.function.name
            tool_arguments = json.loads(tool_call.function.arguments)

            if tool_name not in tools:
                raise ValueError(f'Missing tool: {tool_name}')
                
            tool_response = tools[tool_name](**tool_arguments)
            tool_msg = ToolMessage(
                role='tool',
                content=tool_response,
                tool_call_id=tool_call.id,
                tool_name=tool_name
            )
            tool_messages.append(tool_msg)
        return tool_messages

    def chat(
        self,
        messages: List[ApiMessage],
        tools: Optional[Dict[str, Callable[..., str]]] = None,
        state: Optional[Dict[str, Any]] = None,
        max_turns: int = 3,
        skip_tool_calls: bool = False,
        workflow_id: Optional[str] = None,
        test_profile_id: Optional[str] = None
    ) -> Tuple[List[ApiMessage], Optional[Dict[str, Any]]]:
        """Stateless chat method that handles a single conversation turn with multiple tool call rounds"""
        
        current_messages = messages[:]
        current_state = state
        turns = 0

        response_messages = []
        response_state = None
        has_tool_calls = False
        
        while turns < max_turns:
            # call api
            response_data = self._call_api(
                messages=current_messages,
                state=current_state,
                skip_tool_calls=skip_tool_calls,
                max_turns=max_turns,
                workflow_id=workflow_id,
                test_profile_id=test_profile_id
            )

            current_messages.extend(response_data.messages)
            current_state = response_data.state
            response_messages = response_data.messages
            response_state = response_data.state

            # Process tool calls if present and tools are provided
            last_message = response_data.messages[-1]
            has_tool_calls = hasattr(last_message, 'tool_calls') and last_message.tool_calls
            if has_tool_calls:
                tool_messages = self._process_tool_calls(last_message.tool_calls, tools)
                current_messages.extend(tool_messages)
            
            # If no tool calls were made, we're done
            if not has_tool_calls:
                break
                
            turns += 1
        
        if turns == max_turns and has_tool_calls:
            raise ValueError("Max turns reached")

        if not last_message.agenticResponseType == 'external':
            raise ValueError("Last message was not an external message")

        return response_messages, response_state

class StatefulChat:
    """Maintains conversation state across multiple turns"""
    
    def __init__(
        self,
        client: Client,
        tools: Optional[Dict[str, Callable[..., str]]] = None,
        system_prompt: Optional[str] = None,
        max_turns: int = 3,
        skip_tool_calls: bool = False,
        workflow_id: Optional[str] = None,
        test_profile_id: Optional[str] = None
    ) -> None:
        self.client = client
        self.tools = tools
        self.messages: List[ApiMessage] = []
        self.state: Optional[Dict[str, Any]] = None
        self.max_turns = max_turns
        self.skip_tool_calls = skip_tool_calls
        self.workflow_id = workflow_id
        self.test_profile_id = test_profile_id
        if system_prompt:
            self.messages.append(SystemMessage(role='system', content=system_prompt))

    def run(self, message: Union[str]) -> str:
        """Handle a single user turn in the conversation"""
        
        # Process the message
        user_msg = UserMessage(role='user', content=message)
        self.messages.append(user_msg)

        # Get response using the client's chat method
        new_messages, new_state = self.client.chat(
            messages=self.messages,
            tools=self.tools,
            state=self.state,
            max_turns=self.max_turns,
            skip_tool_calls=self.skip_tool_calls,
            workflow_id=self.workflow_id,
            test_profile_id=self.test_profile_id
        )
        
        # Update internal state
        self.messages = new_messages
        self.state = new_state
        
        # Return only the final message content
        last_message = new_messages[-1]
        return last_message.content


def weather_lookup_tool(city_name: str) -> str:
    return f"The weather in {city_name} is 22°C."


if __name__ == "__main__":
    host: str = "<HOST>"
    project_id: str = "<PROJECT_ID>"
    api_key: str = "<API_KEY>"
    client = Client(host, project_id, api_key)

    tools: Dict[str, Callable[..., str]] = {
        'weather_lookup': weather_lookup_tool
    }
    chat_session = StatefulChat(client, tools)
    resp = chat_session.run("whats the weather in london?")
    print(resp)