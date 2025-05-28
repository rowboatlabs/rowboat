import os
import logging
from openai import AsyncOpenAI, OpenAI
import dotenv
dotenv.load_dotenv()

PROVIDER_BASE_URL = os.getenv('PROVIDER_BASE_URL', '')
PROVIDER_API_KEY = os.getenv('PROVIDER_API_KEY')
PROVIDER_DEFAULT_MODEL = os.getenv('PROVIDER_DEFAULT_MODEL')

client = None
if not PROVIDER_API_KEY:
    PROVIDER_API_KEY = os.getenv('OPENAI_API_KEY')

if not PROVIDER_API_KEY:
    raise(ValueError("No LLM Provider API key found"))

if not PROVIDER_DEFAULT_MODEL:
    PROVIDER_DEFAULT_MODEL = 'gpt-4.1'

if PROVIDER_BASE_URL:
    print(f"Using provider {PROVIDER_BASE_URL}")
    client = AsyncOpenAI(base_url=PROVIDER_BASE_URL, api_key=PROVIDER_API_KEY)
else:
    print("No provider base URL configured, using OpenAI directly")

completions_client = None
if PROVIDER_BASE_URL:
    print(f"Using provider {PROVIDER_BASE_URL} for completions")
    completions_client = OpenAI(
        base_url=PROVIDER_BASE_URL, 
        api_key=PROVIDER_API_KEY
    )
else:
    print(f"Using OpenAI directly for completions")
    completions_client = OpenAI(
        api_key=PROVIDER_API_KEY
    )