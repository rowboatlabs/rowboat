import os
import requests
import json

# Modal API endpoint
API_BASE = "https://stevef1uk--ollama-api-api.modal.run"

# Get credentials from environment variables
token = os.getenv("TOKEN_ID")
secret = os.getenv("TOKEN_SECRET")

if not token or not secret:
    raise ValueError("Please set TOKEN_ID and TOKEN_SECRET environment variables")

headers = {
    "Content-Type": "application/json",
    "Modal-Key": token,
    "Modal-Secret": secret
}

# Test payload
payload = {
    "prompt": "Hello, how are you?",
    "temperature": 0.7,
    "model": "mistral:latest"  # Using the latest Mistral model
}

try:
    print("Making request to Modal API...")
    print(f"Headers: {headers}")
    print(f"Payload: {json.dumps(payload, indent=2)}")
    
    response = requests.post(
        API_BASE,
        json=payload,
        headers=headers,
        verify=True,
        timeout=60
    )
    
    print(f"\nResponse status: {response.status_code}")
    print(f"Response headers: {dict(response.headers)}")
    
    try:
        response_data = response.json()
        print(f"\nResponse data: {json.dumps(response_data, indent=2)}")
    except json.JSONDecodeError:
        print(f"\nRaw response: {response.text}")
        
except Exception as e:
    print(f"\nError occurred: {str(e)}") 