from flask import Flask, request, jsonify, Response
from twilio.twiml.voice_response import VoiceResponse, Gather
import os
import logging
import uuid
from typing import Dict, Any, Optional
import json
from time import time
from rowboat.schema import SystemMessage, UserMessage, ApiMessage
import elevenlabs
# Load environment variables
from load_env import load_environment
load_environment()

from twilio_api import process_conversation_turn


# Import MongoDB utility functions
from util import (
    get_call_state,
    save_call_state,
    delete_call_state,
    get_mongodb_status,
    get_twilio_config,
    CallState
)

Message = SystemMessage | UserMessage

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
elevenlabs_client = elevenlabs.ElevenLabs(api_key=ELEVENLABS_API_KEY)

app = Flask(__name__)

# Configure logging to stdout for Docker compatibility
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]  # Send logs to stdout
)
logger = logging.getLogger(__name__)

# Local in-memory cache of call state (temporary cache only - not primary storage)
# MongoDB is the primary storage for state across multiple instances
active_calls = {}

# TTS configuration
TTS_VOICE = "Markus - Mature and Chill"
TTS_MODEL = "eleven_flash_v2_5"

@app.route('/inbound', methods=['POST'])
def handle_inbound_call():
    """Handle incoming calls to Twilio numbers configured for RowBoat"""
    try:
        # Log the entire request for debugging
        logger.info(f"Received inbound call request: {request.values}")

        # Get the Twilio phone number that received the call
        to_number = request.values.get('To')
        call_sid = request.values.get('CallSid')
        from_number = request.values.get('From')

        logger.info(f"Inbound call from {from_number} to {to_number}, CallSid: {call_sid}")
        logger.info(f"Raw To number value: '{to_number}', Type: {type(to_number)}")

        # Get configuration ONLY from MongoDB
        system_prompt = "You are a helpful assistant. Provide concise and clear answers."
        workflow_id = None
        project_id = None

        # Look up configuration in MongoDB
        twilio_config = get_twilio_config(to_number)
        if twilio_config:
            workflow_id = twilio_config['workflow_id']
            project_id = twilio_config['project_id']
            system_prompt = twilio_config.get('system_prompt', system_prompt)
            logger.info(f"Found MongoDB configuration for {to_number}: project_id={project_id}, workflow_id={workflow_id}")
        else:
            logger.warning(f"No active configuration found in MongoDB for phone number {to_number}")

        if not workflow_id:
            # No workflow found - provide error message
            logger.error(f"No workflow_id found for inbound call to {to_number}")
            response = VoiceResponse()
            response.say("I'm sorry, this phone number is not properly configured in our system. Please contact support.", voice='alice')
            # Include additional information in TwiML for debugging
            response.say(f"Received call to number {to_number}", voice='alice')
            response.hangup()
            return str(response)

        # Initialize call state with stateless API fields
        call_state = CallState(
            workflow_id=workflow_id,
            project_id=project_id,
            system_prompt=system_prompt,
            conversation_history=[],
            messages=[],  # For stateless API
            state=None,   # For stateless API state
            turn_count=0,
            inbound=True,
            to_number=to_number,
            created_at=int(time())  # Add timestamp for expiration tracking
        )

        # Save to MongoDB (primary source of truth)
        try:
            save_call_state(call_sid, call_state)
            logger.info(f"Saved initial call state to MongoDB for inbound call {call_sid}")
        except Exception as e:
            logger.error(f"Error saving inbound call state to MongoDB: {str(e)}")
            raise RuntimeError(f"Failed to save call state to MongoDB: {str(e)}")

        # Only use memory storage as a temporary cache
        # The service that handles the next request might be different
        active_calls[call_sid] = call_state

        logger.info(f"Initialized call state for {call_sid}, proceeding to handle_call")

        # Create a direct response instead of redirecting
        return handle_call(call_sid, workflow_id, project_id)

    except Exception as e:
        # Log the full error with traceback
        import traceback
        logger.error(f"Error in handle_inbound_call: {str(e)}")
        logger.error(traceback.format_exc())

        # Return a basic TwiML response so Twilio doesn't get a 500 error
        response = VoiceResponse()
        response.say("I'm sorry, we encountered an error processing your call. Please try again later.", voice='alice')
        response.hangup()
        return str(response)

@app.route('/twiml', methods=['POST'])
def handle_twiml_call():
    """TwiML endpoint for outbound call handling"""
    call_sid = request.values.get('CallSid')

    # Get call state to retrieve workflow_id and project_id
    call_state = get_call_state(call_sid)
    if call_state:
        workflow_id = call_state.get('workflow_id')
        project_id = call_state.get('project_id')
        return handle_call(call_sid, workflow_id, project_id)
    else:
        # No call state found - error response
        response = VoiceResponse()
        response.say("I'm sorry, your call session has expired. Please try again.", voice='alice')
        response.hangup()
        return str(response)

def handle_call(call_sid, workflow_id, project_id=None):
    """Common handler for both inbound and outbound calls"""
    try:
        logger.info(f"handle_call: processing call {call_sid} with workflow {workflow_id}, project_id {project_id}")

        # Get or initialize call state, first from MongoDB
        call_state = None

        try:
            # Query MongoDB for the call state
            call_state = get_call_state(call_sid)
            if call_state:
                logger.info(f"Loaded and restored call state from MongoDB for {call_sid}")
        except Exception as e:
            logger.error(f"Error retrieving MongoDB state for {call_sid}: {str(e)}")
            call_state = None

        # Try in-memory cache as fallback (temporary local cache)
        if call_state is None and call_sid in active_calls:
            call_state = active_calls.get(call_sid)
            logger.info(f"Using in-memory cache for call state of {call_sid}")

        # Initialize new state if needed
        if call_state is None and workflow_id:
            call_state = CallState(
                workflow_id=workflow_id,
                project_id=project_id,
                system_prompt="You are a helpful assistant. Provide concise and clear answers.",
                conversation_history=[],
                messages=[],  # For stateless API
                state=None,   # For stateless API state
                turn_count=0,
                inbound=False,  # Default for outbound calls
                to_number="",  # This will be set properly for inbound calls
                created_at=int(time()),  # Add timestamp for expiration tracking
                last_transcription=""
            )

            # Save to MongoDB (primary source of truth)
            try:
                save_call_state(call_sid, call_state)
                logger.info(f"Initialized and saved new call state to MongoDB for {call_sid}")
            except Exception as e:
                logger.error(f"Error saving new call state to MongoDB: {str(e)}")
                raise RuntimeError(f"Failed to save call state to MongoDB: {str(e)}")

            # Only use memory as temporary cache for this request
            active_calls[call_sid] = call_state
            logger.info(f"Initialized new call state for {call_sid}")

        logger.info(f"Using call state: {call_state}")

        # Create TwiML response
        response = VoiceResponse()

        # Check if this is a new call
        if call_state.get('turn_count', 0) == 0:
            # Initial greeting for new calls
            greeting = "Hello! I'm your RowBoat assistant. How can I help you today?"
            logger.info(f"New call, preparing greeting: {greeting}")

            try:
                # Use streaming audio endpoint instead of generating files
                # Include a unique ID to prevent caching
                unique_id = str(uuid.uuid4())
                # Use a relative URL - Twilio will use the same host as the webhook
                audio_url = f"/stream-audio/{call_sid}/greeting/{unique_id}"
                logger.info(f"Streaming greeting from relative URL: {audio_url}")

                # Play the greeting via streaming
                response.play(audio_url)
            except Exception as e:
                logger.error(f"Error with audio streaming for greeting: {str(e)}")
                import traceback
                logger.error(traceback.format_exc())
                # Fallback to Twilio TTS
                response.say(greeting, voice='alice')

            # Update call state
            call_state['turn_count'] = 1

            # Save to MongoDB (primary source of truth)
            try:
                save_call_state(call_sid, call_state)
                logger.info(f"Saved greeting state to MongoDB for {call_sid}")
            except Exception as e:
                logger.error(f"Error saving greeting state to MongoDB: {str(e)}")
                raise RuntimeError(f"Failed to save greeting state to MongoDB: {str(e)}")

            # Update local memory cache
            active_calls[call_sid] = call_state

            # Instead of using both Gather and Record which compete for input,
            # just use Gather for speech recognition, and rely on its SpeechResult
            # This is more reliable than trying to use Record and Deepgram
            gather = Gather(
                input='speech',
                action=f'/process_speech?call_sid={call_sid}',
                speech_timeout='auto',
                language='en-US',
                enhanced=True,  # Enable enhanced speech recognition
                speechModel='phone_call'  # Optimize for phone calls
            )
            response.append(gather)

            # If no input detected, redirect to twiml endpoint
            # Call state will be retrieved from MongoDB
            response.redirect('/twiml')

        logger.info(f"Returning response: {str(response)}")
        return str(response)

    except Exception as e:
        # Log the full error with traceback
        import traceback
        logger.error(f"Error in handle_call: {str(e)}")
        logger.error(traceback.format_exc())

        # Return a basic TwiML response
        response = VoiceResponse()
        response.say("I'm sorry, we encountered an error processing your call. Please try again later.", voice='alice')
        response.hangup()
        return str(response)

@app.route('/process_speech', methods=['POST'])
def process_speech():
    """Process user speech input and generate AI response"""
    try:
        logger.info(f"Processing speech: {request.values}")

        call_sid = request.args.get('call_sid')

        # Log all request values for debugging
        logger.info(f"FULL REQUEST VALUES: {dict(request.values)}")
        logger.info(f"FULL REQUEST ARGS: {dict(request.args)}")

        # Get the speech result directly from Twilio
        # We're now relying on Twilio's enhanced speech recognition instead of Deepgram
        speech_result = request.values.get('SpeechResult')
        confidence = request.values.get('Confidence')

        logger.info(f"Twilio SpeechResult: {speech_result}")
        logger.info(f"Twilio Confidence: {confidence}")

        if not call_sid:
            logger.warning(f"Missing call_sid: {call_sid}")
            response = VoiceResponse()
            response.say("I'm sorry, I couldn't process that request.", voice='alice')
            response.hangup()
            return str(response)

        if not speech_result:
            logger.warning("No speech result after transcription attempts")
            response = VoiceResponse()
            response.say("I'm sorry, I didn't catch what you said. Could you please try again?", voice='alice')

            # Gather user input again
            gather = Gather(
                input='speech',
                action=f'/process_speech?call_sid={call_sid}',
                speech_timeout='auto',
                language='en-US',
                enhanced=True,
                speechModel='phone_call'
            )
            response.append(gather)

            # Redirect to twiml endpoint which will get call state from MongoDB
            response.redirect('/twiml')

            return str(response)

        # Load call state from MongoDB (primary source of truth)
        call_state = None

        try:
            call_state = get_call_state(call_sid)
            if call_state:
                logger.info(f"Loaded call state from MongoDB for speech processing: {call_sid}")
        except Exception as e:
            logger.error(f"Error retrieving MongoDB state for speech processing: {str(e)}")
            call_state = None

        # Try memory cache as fallback
        if call_state is None and call_sid in active_calls:
            call_state = active_calls[call_sid]
            logger.info(f"Using in-memory state for speech processing: {call_sid}")

        # Check if we have valid state
        if not call_state:
            logger.warning(f"No call state found for speech processing: {call_sid}")
            response = VoiceResponse()
            response.say("I'm sorry, your call session has expired. Please call back.", voice='alice')
            response.hangup()
            return str(response)

        # Extract key information
        workflow_id = call_state.get('workflow_id')
        project_id = call_state.get('project_id')
        system_prompt = call_state.get('system_prompt', "You are a helpful assistant.")

        # Check if we have a Deepgram transcription stored in the call state
        if 'last_transcription' in call_state and call_state['last_transcription']:
            deepgram_transcription = call_state['last_transcription']
            logger.info(f"Found stored Deepgram transcription: {deepgram_transcription}")
            logger.info(f"Comparing with Twilio transcription: {speech_result}")

            # Use the Deepgram transcription instead of Twilio's
            speech_result = deepgram_transcription
            # Remove it so we don't use it again
            del call_state['last_transcription']
            logger.info(f"Using Deepgram transcription instead")

        # Log final user input that will be used
        logger.info(f"Final user input: {speech_result}")

        # Process with RowBoat agent
        try:
            # Clean up the speech result if needed
            if speech_result:
                # Remove any common filler words or fix typical transcription issues
                import re
                # Convert to lowercase for easier pattern matching
                cleaned_input = speech_result.lower()
                # Remove filler words that might be at the beginning
                cleaned_input = re.sub(r'^(um|uh|like|so|okay|well)\s+', '', cleaned_input)
                # Capitalize first letter for better appearance
                if cleaned_input:
                    speech_result = cleaned_input[0].upper() + cleaned_input[1:]

            logger.info(f"Sending to RowBoat: '{speech_result}'")

            # Get previous messages and state from call state
            previous_messages = call_state.get('messages', [])
            previous_state = call_state.get('state')

            # Process with stateless API
            ai_response, updated_messages, updated_state = process_conversation_turn(
                user_input=speech_result,
                workflow_id=workflow_id,
                system_prompt=system_prompt,
                previous_messages=previous_messages,
                previous_state=previous_state,
                project_id=project_id
            )

            # Update the messages and state in call state
            call_state['messages'] = updated_messages
            call_state['state'] = updated_state

            logger.info(f"RowBoat response: {ai_response}")
        except Exception as e:
            logger.error(f"Error processing with RowBoat: {str(e)}")
            ai_response = "I'm sorry, I encountered an issue processing your request. Could you please try again?"

        # Conversation history is updated in the streaming response section below

        # Create TwiML response
        response = VoiceResponse()

        # Use streaming audio for the response
        logger.info("Setting up response streaming with ElevenLabs")

        try:
            # Store the AI response in conversation history first
            # (The stream-audio endpoint will read it from here)

            # Update conversation history (do this before streaming so the endpoint can access it)
            call_state['conversation_history'].append({
                'user': speech_result,
                'assistant': ai_response
            })
            call_state['turn_count'] += 1

            # Save to MongoDB (primary source of truth)
            try:
                save_call_state(call_sid, call_state)
                logger.info(f"Saved response state to MongoDB for {call_sid}")
            except Exception as e:
                logger.error(f"Error saving response state to MongoDB: {str(e)}")
                raise RuntimeError(f"Failed to save response state to MongoDB: {str(e)}")

            # Update local memory cache
            active_calls[call_sid] = call_state

            # Generate a unique ID to prevent caching
            unique_id = str(uuid.uuid4())
            # Use a relative URL - Twilio will use the same host as the webhook
            audio_url = f"/stream-audio/{call_sid}/response/{unique_id}"
            logger.info(f"Streaming response from relative URL: {audio_url}")

            # Play the response via streaming
            response.play(audio_url)
        except Exception as e:
            logger.error(f"Error with audio streaming for response: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            # Fallback to Twilio TTS
            response.say(ai_response, voice='alice')

        # Gather next user input with enhanced speech recognition
        gather = Gather(
            input='speech',
            action=f'/process_speech?call_sid={call_sid}',
            speech_timeout='auto',
            language='en-US',
            enhanced=True,  # Enable enhanced speech recognition
            speechModel='phone_call'  # Optimize for phone calls
        )
        response.append(gather)

        # If no input detected, redirect to twiml endpoint
        # Call state will be retrieved from MongoDB
        response.redirect('/twiml')

        logger.info(f"Returning TwiML response for speech processing")
        return str(response)

    except Exception as e:
        # Log the full error with traceback
        import traceback
        logger.error(f"Error in process_speech: {str(e)}")
        logger.error(traceback.format_exc())

        # Return a basic TwiML response
        response = VoiceResponse()
        response.say("I'm sorry, we encountered an error processing your speech. Please try again.", voice='alice')
        response.gather(
            input='speech',
            action=f'/process_speech?call_sid={request.args.get("call_sid")}',
            speech_timeout='auto'
        )
        return str(response)

@app.route('/stream-audio/<call_sid>/<text_type>/<unique_id>', methods=['GET'])
def stream_audio(call_sid, text_type, unique_id):
    """Stream audio directly from ElevenLabs to Twilio without saving to disk"""
    try:
        logger.info(f"Audio streaming requested for call {call_sid}, type {text_type}")

        # Determine what text to synthesize
        text_to_speak = ""

        if text_type == "greeting":
            # Use default greeting
            text_to_speak = "Hello! I'm your RowBoat assistant. How can I help you today?"
        elif text_type == "response":
            # Get the text from call state (try MongoDB first, then memory)
            call_state = None

            # Try MongoDB first
            try:
                call_state = get_call_state(call_sid)
                if call_state:
                    logger.info(f"Loaded call state from MongoDB for streaming: {call_sid}")
            except Exception as e:
                logger.error(f"Error retrieving MongoDB state for streaming: {str(e)}")
                call_state = None

            # Fall back to memory if needed
            if call_state is None:
                if call_sid not in active_calls:
                    logger.error(f"Call SID not found for streaming: {call_sid}")
                    return "Call not found", 404

                call_state = active_calls[call_sid]
                logger.info(f"Using in-memory state for streaming: {call_sid}")
            if call_state.get('conversation_history') and len(call_state['conversation_history']) > 0:
                # Get the most recent AI response
                text_to_speak = call_state['conversation_history'][-1]['assistant']
            else:
                logger.warning(f"No conversation history found for call {call_sid}")
                text_to_speak = "I'm sorry, I don't have a response ready. Could you please repeat?"
        else:
            # Direct text may be passed as the text_type (for testing)
            text_to_speak = text_type

        if not text_to_speak:
            logger.error("No text to synthesize")
            return "No text to synthesize", 400

        logger.info(f"Streaming audio for text: {text_to_speak[:50]}...")


        def generate():
            try:
                # Generate and stream the audio directly
                audio_stream = elevenlabs_client.generate(
                    text=text_to_speak,
                    voice=TTS_VOICE,
                    model=TTS_MODEL,
                    output_format="mp3_44100_128"
                )

                # Stream chunks directly to the response
                for chunk in audio_stream:
                    yield chunk

                logger.info(f"Finished streaming audio for call {call_sid}")
            except Exception as e:
                logger.error(f"Error in audio stream generator: {str(e)}")
                import traceback
                logger.error(traceback.format_exc())

        # Return a streaming response
        response = Response(generate(), mimetype='audio/mpeg')
        return response

    except Exception as e:
        logger.error(f"Error setting up audio stream: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return "Error streaming audio", 500

@app.route('/call-status', methods=['POST'])
def call_status_callback():
    """Handle call status callbacks from Twilio"""
    call_sid = request.values.get('CallSid')
    call_status = request.values.get('CallStatus')

    logger.info(f"Call {call_sid} status: {call_status}")

    # Clean up resources when call completes
    if call_status in ['completed', 'failed', 'busy', 'no-answer', 'canceled']:
        # Get call state from MongoDB or memory
        call_state = None

        # Try to load from MongoDB first
        try:
            call_state = get_call_state(call_sid)
            if call_state:
                logger.info(f"Loaded final state from MongoDB for {call_sid}")
        except Exception as e:
            logger.error(f"Error retrieving final state from MongoDB: {str(e)}")
            call_state = None

        # Fall back to memory if needed
        if call_state is None and call_sid in active_calls:
            call_state = active_calls[call_sid]
            logger.info(f"Using in-memory state for final call state of {call_sid}")

        if call_state:
            # Remove from active calls in both memory and MongoDB
            if call_sid in active_calls:
                del active_calls[call_sid]
                logger.info(f"Removed call {call_sid} from active calls memory")

            try:
                # Remove the document from MongoDB
                delete_call_state(call_sid)
                logger.info(f"Removed call {call_sid} from MongoDB")
            except Exception as e:
                logger.error(f"Error removing call state from MongoDB: {str(e)}")
    return '', 204


@app.route('/health', methods=['GET'])
def health_check():
    """Simple health check endpoint"""
    health_data = {
        "status": "healthy",
        "active_calls_memory": len(active_calls)
    }

    # Get MongoDB status
    try:
        mongodb_status = get_mongodb_status()
        health_data["mongodb"] = mongodb_status
        health_data["active_calls_mongodb"] = mongodb_status.get("active_calls", 0)
    except Exception as e:
        health_data["mongodb_error"] = str(e)
        health_data["status"] = "degraded"

    return jsonify(health_data)

if __name__ == '__main__':
    # Log startup information
    logger.info(f"Starting Twilio-RowBoat server")
    # Remove the explicit run configuration since Flask CLI will handle it
    app.run()