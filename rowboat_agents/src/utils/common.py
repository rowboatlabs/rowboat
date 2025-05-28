import json
import logging
import os
import subprocess
import sys
import time
from dotenv import load_dotenv
from openai import OpenAI

from src.utils.client import completions_client
load_dotenv()

def setup_logger(name, log_file='./run.log', level=logging.INFO, log_to_file=False):
    """Function to set up a logger with a specific name and log file."""
    formatter = logging.Formatter('%(asctime)s %(levelname)s [%(filename)s:%(lineno)d] %(message)s')

    # Changed to use stderr instead of stdout
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(formatter)

    # Create a logger and set its level
    logger = logging.getLogger(name)
    logger.setLevel(level)
    
    # Clear any existing handlers to avoid duplicates
    if logger.hasHandlers():
        logger.handlers.clear()
    
    # Prevent propagation to parent loggers
    logger.propagate = False
        
    logger.addHandler(handler)

    return logger

common_logger = setup_logger('logger')
logger = common_logger

def read_json_from_file(file_name):
    logger.info(f"Reading json from {file_name}")
    try:
        with open(file_name, 'r') as file: 
            out = file.read()
            out = json.loads(out)
            return out
    except Exception as e:
        logger.error(e)
        return None

def get_api_key(key_name):
    api_key = os.getenv(key_name)
    # Check if the API key was loaded successfully
    if not api_key:
        raise ValueError(f"{key_name} not found. Did you set it in the .env file?")
    return api_key

def generate_model_output_from_multi_turn_conv(messages, output_type='json', model=None):
    """Generate output from a multi-turn conversation using any supported model."""
    return generate_openai_output(messages, output_type, model)

def generate_openai_output(messages, output_type='not_json', model=None, return_completion=False, tools=None):
    """Generate output using any model through the configured provider (e.g. LiteLLM).
    All models are handled through the same OpenAI-compatible interface."""
    print(f"Using client: {completions_client} and model: {model}")
    try:
        # Prepare the API call parameters
        params = {
            "model": model,
            "messages": messages,
        }
        
        # Add tools if provided
        if tools:
            params["tools"] = tools
            # For Modal models, we need to format the tools in a way they can understand
            if model and model.startswith("modal/"):
                # Convert OpenAI-style tools to Modal format
                modal_tools = []
                for tool in tools:
                    if "function" in tool:
                        modal_tool = {
                            "name": tool["function"]["name"],
                            "description": tool["function"]["description"],
                            "parameters": tool["function"]["parameters"]
                        }
                        modal_tools.append(modal_tool)
                params["tools"] = modal_tools
            
        # Add response format for JSON output
        if output_type == 'json':
            params["response_format"] = {"type": "json_object"}
            
        # Make the API call
        chat_completion = completions_client.chat.completions.create(**params)
        
        if return_completion:
            return chat_completion
        return chat_completion.choices[0].message.content

    except Exception as e:
        logger.error(e)
        return None

def generate_llm_output(messages, model, tools=None):
    """Generate output using any model through the configured provider.
    The actual model routing is handled by the provider (e.g. LiteLLM)."""
    return generate_openai_output(messages, output_type='text', model=model, tools=tools)

def generate_model_output_from_multi_turn_conv_multithreaded(messages, retries=5, delay=1, output_type='json', model=None):
    """Generate output from a multi-turn conversation with retry logic for any supported model."""
    while retries > 0:
        try:
            output = generate_model_output_from_multi_turn_conv(messages, output_type=output_type, model=model)
            return output
        except Exception as e:
            print(f'Error occurred. Retrying in {delay} seconds...')
            time.sleep(delay)
            delay *= 2  # Exponential backoff
            retries -= 1

    if retries == 0:
        print(f'Failed to process after multiple retries.')
        return []

def convert_message_content_json_to_strings(messages):
    for msg in messages:
        if 'content' in msg.keys() and isinstance(msg['content'], dict):
            msg['content'] = json.dumps(msg['content'])
    return messages

def merge_defaultdicts(dict_parent, dict_child):
    for key, value in dict_child.items():
        if key in dict_parent:
            # If the key exists in both, handle merging based on type
            if isinstance(dict_parent[key], list):
                dict_parent[key].extend(value)
            elif isinstance(dict_parent[key], dict):
                dict_parent[key].update(value)
            elif isinstance(dict_parent[key], set):
                dict_parent[key].update(value)
            else:
                dict_parent[key] += value  # For other types like int, float, etc.
        else:
            dict_parent[key] = value
    
    return dict_parent

def read_jsonl_from_file(file_name):
    # logger.info(f"Reading jsonl from {file_name}")
    try:
        with open(file_name, 'r') as file:
            lines = file.readlines()
            dataset = [json.loads(line.strip()) for line in lines]
        return dataset
    except Exception as e:
        logger.error(e)
        return None

def write_jsonl_to_file(list_dicts, file_name):
    try:
        with open(file_name, 'w') as file:
            for d in list_dicts:
                file.write(json.dumps(d)+'\n')
        return True
    except Exception as e:
        logger.error(e)
        return False

def read_text_from_file(file_name):
    try:
        with open(file_name, 'r') as file: 
            out = file.read()
        return out
    except Exception as e:
        logger.error(e)
        return None
    
def write_json_to_file(data, file_name):
    try:
        with open(file_name, 'w') as file:
            json.dump(data, file, indent=4)
        return True
    except Exception as e:
        logger.error(e)
        return False


def get_git_path(path):
    # Run `git rev-parse --show-toplevel` to get the root of the Git repository
    try:
        git_root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
        return f"{git_root}/{path}"
    except subprocess.CalledProcessError:
        raise RuntimeError("Not inside a Git repository")

def update_tokens_used(provider, model, tokens_used, completion):
    provider_model = f"{provider}/{model}"
    input_tokens = completion.usage.prompt_tokens
    output_tokens = completion.usage.completion_tokens
    
    if provider_model not in tokens_used:   
        tokens_used[provider_model] = {
            'input_tokens': 0,
            'output_tokens': 0,
        }
    
    tokens_used[provider_model]['input_tokens'] += input_tokens
    tokens_used[provider_model]['output_tokens'] += output_tokens
    
    return tokens_used