from twilio.rest import Client as TwilioClient
from rowboat import Client, StatefulChat
import os
from typing import Dict, List, Optional, Tuple
import json
from deepgram import DeepgramClient
import elevenlabs
import time
import logging

# Load environment variables
from load_env import load_environment
load_environment()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    filename='twilio_api.log'
)
logger = logging.getLogger(__name__)

# Environment variables and configuration
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")
ROWBOAT_API_HOST = os.environ.get("ROWBOAT_API_HOST", "http://127.0.0.1:3000").strip()
ROWBOAT_PROJECT_ID = os.environ.get("ROWBOAT_PROJECT_ID", "faf2bfb3-41d4-4299-b0d2-048581ea9bd8")
ROWBOAT_API_KEY = os.environ.get("ROWBOAT_API_KEY", "3f95055836f77714298a6d0d69f4a4cd1119bf979b341cceb96e9cdba4a6df15")

# Initialize API clients
twilio_client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN else None
rowboat_client = Client(
    host=ROWBOAT_API_HOST,
    project_id=ROWBOAT_PROJECT_ID,
    api_key=ROWBOAT_API_KEY
)

# Initialize Deepgram and ElevenLabs clients with API keys from environment variables
DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "99bc0dbdf0dd742c80e458ba616b727c3819b004")
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "b37f6f3ceaca6f8999d8ea3c31d5e4bd")

deepgram_client = DeepgramClient(api_key=DEEPGRAM_API_KEY)
elevenlabs_client = elevenlabs.ElevenLabs(api_key=ELEVENLABS_API_KEY)

def provision_phone_number(area_code: str = None, country_code: str = "US") -> Dict:
    """
    Provision a new Twilio phone number.
    
    Args:
        area_code: Optional area code to filter phone numbers
        country_code: Country code (default: US)
        
    Returns:
        Dict with phone number details or error
    """
    if not twilio_client:
        logger.error("Twilio client not initialized - missing credentials")
        return {"error": "Twilio credentials not configured"}
    
    try:
        # Search for available phone numbers
        available_numbers = twilio_client.available_phone_numbers(country_code).local.list(
            area_code=area_code,
            limit=1
        )
        
        if not available_numbers:
            logger.warning(f"No available phone numbers found for area code {area_code}")
            return {"error": f"No phone numbers available for area code {area_code}"}
        
        # Purchase the first available number
        number = twilio_client.incoming_phone_numbers.create(
            phone_number=available_numbers[0].phone_number
        )
        
        logger.info(f"Successfully provisioned phone number: {number.phone_number}")
        return {
            "phone_number": number.phone_number,
            "sid": number.sid,
            "friendly_name": number.friendly_name,
            "date_created": str(number.date_created)
        }
        
    except Exception as e:
        logger.error(f"Error provisioning phone number: {str(e)}")
        return {"error": str(e)}

def make_outbound_call(
    to_number: str, 
    from_number: str, 
    workflow_id: str,
    system_prompt: str = "You are a helpful assistant. Provide concise and clear answers.",
    twiml_callback_url: Optional[str] = None
) -> Dict:
    """
    Make an outbound call from a Twilio number to connect with a RowBoat agent.
    
    Args:
        to_number: Destination phone number (E.164 format)
        from_number: Twilio phone number to call from (E.164 format)
        workflow_id: RowBoat workflow ID for the conversation
        system_prompt: System prompt for the RowBoat agent
        twiml_callback_url: URL to TwiML for call handling
        
    Returns:
        Dict with call details or error
    """
    if not twilio_client:
        logger.error("Twilio client not initialized - missing credentials")
        return {"error": "Twilio credentials not configured"}
    
    try:
        # If no TwiML callback URL is provided, use the default webhook
        if not twiml_callback_url:
            twiml_callback_url = f"https://your-server.com/twiml?workflow_id={workflow_id}"
        
        # Make the call
        call = twilio_client.calls.create(
            to=to_number,
            from_=from_number,
            url=twiml_callback_url,
            status_callback=f"https://your-server.com/call-status",
            status_callback_event=['initiated', 'ringing', 'answered', 'completed'],
            status_callback_method='POST'
        )
        
        logger.info(f"Initiated call SID: {call.sid} to {to_number}")
        return {
            "call_sid": call.sid,
            "status": call.status,
            "to": to_number,
            "from": from_number,
            "workflow_id": workflow_id
        }
        
    except Exception as e:
        logger.error(f"Error making outbound call: {str(e)}")
        return {"error": str(e)}

def transcribe_audio(audio_url: str) -> str:
    """
    Transcribe audio using Deepgram.
    
    Args:
        audio_url: URL to the audio file
        
    Returns:
        Transcribed text
    """
    try:
        # Configure transcription options
        options = {
            "model": "nova-3",
            "punctuate": True,
            "language": "en-US",
        }
        
        # Perform transcription
        response = deepgram_client.listen.prerecorded.v("1").transcribe_url(
            {"url": audio_url}, options
        )
        
        # Extract transcription text
        transcript = response.results.channels[0].alternatives[0].transcript
        return transcript
        
    except Exception as e:
        logger.error(f"Error transcribing audio: {str(e)}")
        return ""

def text_to_speech(text: str) -> bytes:
    """
    Convert text to speech using ElevenLabs.
    
    Args:
        text: Text to convert to speech
        
    Returns:
        Audio bytes
    """
    try:
        audio = elevenlabs_client.generate(
            text=text,
            voice="Rachel",
            model="eleven_monolingual_v1",
            output_format="mp3_44100_128"
        )
        return audio
        
    except Exception as e:
        logger.error(f"Error with ElevenLabs TTS: {str(e)}")
        return None

def process_conversation_turn(
    user_input: str, 
    workflow_id: str, 
    system_prompt: str = "You are a helpful assistant. Provide concise and clear answers."
) -> str:
    """
    Process a single conversation turn with the RowBoat agent.
    
    Args:
        user_input: User's transcribed input
        workflow_id: RowBoat workflow ID
        system_prompt: System prompt for the agent
        
    Returns:
        Agent's response text
    """
    try:
        support_chat = StatefulChat(
            rowboat_client,
            system_prompt=system_prompt,
            workflow_id=workflow_id
        )
        
        # Process user input through the chat system
        rowboat_response = support_chat.run(user_input)
        return rowboat_response
        
    except Exception as e:
        logger.error(f"Error processing conversation turn: {str(e)}")
        return "I'm sorry, I encountered an error processing your request."