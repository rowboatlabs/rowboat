from typing import Dict, List, Optional
import requests
from .schema import (
    ApiRequest, 
    ApiResponse, 
    ApiMessage, 
    UserMessage, 
)

class Client:
    def __init__(self, host: str, projectId: str, apiKey: str) -> None:
        self.base_url: str = f'{host}/api/v1/{projectId}/chat'
        self.headers: Dict[str, str] = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {apiKey}'
        }

    def _call_api(
        self, 
        messages: List[ApiMessage],
        conversationId: Optional[str] = None,
        mockTools: Optional[Dict[str, str]] = None
    ) -> ApiResponse:
        request = ApiRequest(
            messages=messages,
            conversationId=conversationId,
            mockTools=mockTools
        )
        json_data = request.model_dump()
        response = requests.post(self.base_url, headers=self.headers, json=json_data)

        if not response.status_code == 200:
            raise ValueError(f"Error: {response.status_code} - {response.text}")
    
        return ApiResponse.model_validate(response.json())

    def run_turn(
        self,
        messages: List[ApiMessage],
        conversationId: Optional[str] = None,
        mockTools: Optional[Dict[str, str]] = None,
    ) -> ApiResponse:
        """Stateless chat method that handles a single conversation turn"""
        
        # call api
        return self._call_api(
            messages=messages,
            conversationId=conversationId,
            mockTools=mockTools,
        )


if __name__ == "__main__":
    host: str = "<HOST>"
    project_id: str = "<PROJECT_ID>"
    api_key: str = "<API_KEY>"
    client = Client(host, project_id, api_key)

    result = client.run_turn(
        messages=[
            UserMessage(role='user', content="list my github repos")
        ]
    )
    print(result.turn.output[-1].content)
    print(result.conversationId)

    result = client.run_turn(
        messages=[
            UserMessage(role='user', content="how many did you find?")
        ],
        conversationId=result.conversationId
    )
    print(result.turn.output[-1].content)