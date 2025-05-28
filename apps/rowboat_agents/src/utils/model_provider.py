import os
import logging
from typing import List, Dict, Any, Optional, Union
from openai import OpenAI, AsyncOpenAI
import litellm
from litellm import completion, acompletion

# Configure logging
logger = logging.getLogger(__name__)

class ModelProvider:
    def __init__(self):
        self.provider_base_url = os.getenv('PROVIDER_BASE_URL', '')
        self.provider_api_key = os.getenv('PROVIDER_API_KEY') or os.getenv('OPENAI_API_KEY')
        self.default_model = os.getenv('PROVIDER_DEFAULT_MODEL', 'gpt-4.1')
        
        if not self.provider_api_key:
            raise ValueError("No LLM Provider API key found")
        
        # Initialize clients
        self._init_clients()
        
    def _init_clients(self):
        """Initialize OpenAI and LiteLLM clients based on configuration."""
        if self.provider_base_url:
            logger.info(f"Using provider {self.provider_base_url}")
            self.openai_client = AsyncOpenAI(
                base_url=self.provider_base_url,
                api_key=self.provider_api_key
            )
            self.completions_client = OpenAI(
                base_url=self.provider_base_url,
                api_key=self.provider_api_key
            )
        else:
            logger.info("Using OpenAI directly")
            self.openai_client = AsyncOpenAI(api_key=self.provider_api_key)
            self.completions_client = OpenAI(api_key=self.provider_api_key)
            
        # Configure LiteLLM
        litellm.api_key = self.provider_api_key
        if self.provider_base_url:
            litellm.api_base = self.provider_base_url

    def _is_litellm_model(self, model_name: str) -> bool:
        """Check if the model should be handled by LiteLLM."""
        # Add your logic here to determine if a model should use LiteLLM
        # For example, check if it's a non-OpenAI model
        return not model_name.startswith('gpt-')

    async def generate_output(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        output_type: str = 'text',
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        stream: bool = False
    ) -> Union[str, Dict[str, Any]]:
        """
        Generate output using either OpenAI or LiteLLM based on the model.
        
        Args:
            messages: List of message dictionaries
            model: Model name to use (defaults to provider default)
            output_type: Type of output ('text' or 'json')
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            stream: Whether to stream the response
            
        Returns:
            Generated output as string or dictionary
        """
        model = model or self.default_model
        
        try:
            if self._is_litellm_model(model):
                return await self._generate_litellm_output(
                    messages=messages,
                    model=model,
                    output_type=output_type,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=stream
                )
            else:
                return await self._generate_openai_output(
                    messages=messages,
                    model=model,
                    output_type=output_type,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=stream
                )
        except Exception as e:
            logger.error(f"Error generating output: {str(e)}")
            raise

    async def _generate_openai_output(
        self,
        messages: List[Dict[str, str]],
        model: str,
        output_type: str = 'text',
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        stream: bool = False
    ) -> Union[str, Dict[str, Any]]:
        """Generate output using OpenAI API."""
        try:
            kwargs = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
            }
            
            if max_tokens:
                kwargs["max_tokens"] = max_tokens
                
            if output_type == 'json':
                kwargs["response_format"] = {"type": "json_object"}
                
            if stream:
                kwargs["stream"] = True
                
            completion = await self.openai_client.chat.completions.create(**kwargs)
            
            if stream:
                return completion
            else:
                return completion.choices[0].message.content
                
        except Exception as e:
            logger.error(f"OpenAI API error: {str(e)}")
            raise

    async def _generate_litellm_output(
        self,
        messages: List[Dict[str, str]],
        model: str,
        output_type: str = 'text',
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        stream: bool = False
    ) -> Union[str, Dict[str, Any]]:
        """Generate output using LiteLLM."""
        try:
            kwargs = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
            }
            
            if max_tokens:
                kwargs["max_tokens"] = max_tokens
                
            if output_type == 'json':
                kwargs["response_format"] = {"type": "json_object"}
                
            if stream:
                kwargs["stream"] = True
                
            completion = await acompletion(**kwargs)
            
            if stream:
                return completion
            else:
                return completion.choices[0].message.content
                
        except Exception as e:
            logger.error(f"LiteLLM API error: {str(e)}")
            raise

# Create a singleton instance
model_provider = ModelProvider() 