from flask import Flask, request, jsonify, Response
from twilio.twiml.voice_response import VoiceResponse, Gather
import os
import logging
import base64
import tempfile
import uuid
from typing import Dict, Any
import json

# Load environment variables
from load_env import load_environment
load_environment()

# Import our twilio api module
from twilio_api import (
    provision_phone_number,
    make_outbound_call,
    transcribe_audio,
    text_to_speech,
    process_conversation_turn
)

app = Flask(__name__)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    filename='twilio_server.log'
)
logger = logging.getLogger(__name__)

# Store active calls with their state
active_calls = {}

# Store phone number to workflow mappings for inbound calls
# Format: {"phone_number": {"workflow_id": "...", "project_id": "...", "system_prompt": "..."}}
phone_number_mappings = {}
TTS_VOICE = "Markus - Mature and Chill"
TTS_MODEL = "eleven_flash_v2_5"

@app.route('/api/phone-numbers', methods=['POST'])
def api_provision_number():
    """API endpoint to provision a new Twilio phone number"""
    data = request.json or {}
    area_code = data.get('area_code')
    country_code = data.get('country_code', 'US')

    # Optional parameters for automatically configuring inbound calls
    workflow_id = data.get('workflow_id')
    project_id = data.get('project_id')
    system_prompt = data.get('system_prompt')

    result = provision_phone_number(area_code, country_code)

    # If the number was provisioned successfully and workflow details provided,
    # configure it for inbound calls
    if 'error' not in result and workflow_id:
        phone_number = result['phone_number']

        # Configure the number for inbound calls
        configure_result = configure_number_for_inbound(
            phone_number,
            workflow_id,
            project_id,
            system_prompt
        )

        # Add configuration info to the result
        result['inbound_configured'] = 'error' not in configure_result
        if 'error' in configure_result:
            result['inbound_error'] = configure_result['error']

    return jsonify(result)

@app.route('/api/inbound-config', methods=['POST'])
def api_configure_inbound():
    """API endpoint to configure a phone number for inbound calls"""
    data = request.json or {}

    # Validate required parameters
    if 'phone_number' not in data or 'workflow_id' not in data:
        return jsonify({"error": "Missing required parameters: phone_number and workflow_id"}), 400

    phone_number = data['phone_number']
    workflow_id = data['workflow_id']
    project_id = data.get('project_id')
    system_prompt = data.get('system_prompt')

    result = configure_number_for_inbound(phone_number, workflow_id, project_id, system_prompt)
    return jsonify(result)

@app.route('/api/inbound-config', methods=['GET'])
def api_list_inbound_configs():
    """List all phone numbers configured for inbound calls"""
    return jsonify({
        "mappings": phone_number_mappings,
        "count": len(phone_number_mappings)
    })

@app.route('/api/inbound-config/<phone_number>', methods=['DELETE'])
def api_delete_inbound_config(phone_number):
    """Remove inbound call configuration for a phone number"""
    # Normalize the phone number format
    phone_number = phone_number.strip()
    if not phone_number.startswith('+'):
        phone_number = '+' + phone_number

    if phone_number in phone_number_mappings:
        del phone_number_mappings[phone_number]
        # Save the updated mappings
        save_phone_mappings()
        return jsonify({"status": "deleted"})
    else:
        return jsonify({"error": "Phone number not found"}), 404

def configure_number_for_inbound(phone_number, workflow_id, project_id=None, system_prompt=None):
    """
    Configure a Twilio phone number to handle inbound calls with RowBoat.

    Args:
        phone_number: The phone number to configure (E.164 format)
        workflow_id: RowBoat workflow ID to connect to this number
        project_id: RowBoat project ID (optional, uses default if not provided)
        system_prompt: System prompt for the conversation (optional)

    Returns:
        Dict with configuration results
    """
    from twilio_api import twilio_client

    # Normalize the phone number format
    phone_number = phone_number.strip()
    if not phone_number.startswith('+'):
        phone_number = '+' + phone_number

    try:
        if not twilio_client:
            return {"error": "Twilio client not initialized"}

        # Get base URL from environment or request host
        base_url = os.environ.get('BASE_URL')
        if not base_url:
            # Try to get base URL from request context
            if request:
                host_url = request.host_url.rstrip('/')
                if host_url.startswith('http'):  # Make sure it's a proper URL
                    base_url = host_url

            if not base_url:
                logger.warning("BASE_URL not set in environment and couldn't determine from request. Using localhost.")
                base_url = "http://localhost:3009"

        # Find the phone number in Twilio account
        incoming_phone_numbers = twilio_client.incoming_phone_numbers.list(phone_number=phone_number)

        if not incoming_phone_numbers:
            return {"error": f"Phone number {phone_number} not found in Twilio account"}

        phone_sid = incoming_phone_numbers[0].sid

        # Set the voice URL to our webhook endpoint with workflow ID
        twilio_client.incoming_phone_numbers(phone_sid).update(
            voice_url=f"{base_url}/inbound?workflow_id={workflow_id}",
            voice_method='POST',
            status_callback=f"{base_url}/call-status",
            status_callback_method='POST'
        )

        # Store the mapping in our application
        phone_number_mappings[phone_number] = {
            'workflow_id': workflow_id,
            'project_id': project_id or os.environ.get('ROWBOAT_PROJECT_ID'),
            'system_prompt': system_prompt or "You are a helpful assistant. Provide concise and clear answers."
        }

        # Save the mappings to disk
        save_phone_mappings()

        logger.info(f"Configured phone number {phone_number} for inbound calls with workflow {workflow_id}")
        return {
            "status": "configured",
            "phone_number": phone_number,
            "workflow_id": workflow_id
        }

    except Exception as e:
        logger.error(f"Error configuring inbound call for {phone_number}: {str(e)}")
        return {"error": str(e)}

@app.route('/api/calls', methods=['POST'])
def api_make_call():
    """API endpoint to initiate an outbound call"""
    data = request.json or {}

    # Validate required parameters
    if not all(k in data for k in ['to_number', 'from_number', 'workflow_id']):
        return jsonify({"error": "Missing required parameters"}), 400

    # Extract parameters
    to_number = data['to_number']
    from_number = data['from_number']
    workflow_id = data['workflow_id']
    system_prompt = data.get('system_prompt', "You are a helpful assistant. Provide concise and clear answers.")

    # Generate callback URL with base URL from environment or request
    base_url = os.environ.get('BASE_URL', request.host_url.rstrip('/'))
    twiml_callback_url = f"{base_url}/twiml?workflow_id={workflow_id}"

    # Initiate the call
    result = make_outbound_call(
        to_number=to_number,
        from_number=from_number,
        workflow_id=workflow_id,
        system_prompt=system_prompt,
        twiml_callback_url=twiml_callback_url
    )

    if 'error' not in result:
        # Initialize call state
        call_sid = result['call_sid']
        active_calls[call_sid] = {
            'workflow_id': workflow_id,
            'system_prompt': system_prompt,
            'conversation_history': [],
            'turn_count': 0
        }

    return jsonify(result)

def save_phone_mappings():
    """Save phone number mappings to a JSON file"""
    try:
        with open('phone_mappings.json', 'w') as f:
            json.dump(phone_number_mappings, f, indent=2)
        logger.info(f"Saved phone mappings: {len(phone_number_mappings)} entries")
    except Exception as e:
        logger.error(f"Error saving phone mappings: {str(e)}")

def load_phone_mappings():
    """Load phone number mappings from a JSON file"""
    global phone_number_mappings
    try:
        if os.path.exists('phone_mappings.json'):
            with open('phone_mappings.json', 'r') as f:
                phone_number_mappings = json.load(f)
            logger.info(f"Loaded phone mappings: {len(phone_number_mappings)} entries")
    except Exception as e:
        logger.error(f"Error loading phone mappings: {str(e)}")
        phone_number_mappings = {}

@app.route('/inbound', methods=['POST'])
def handle_inbound_call():
    """Handle incoming calls to Twilio numbers configured for RowBoat"""
    try:
        # Log the entire request for debugging
        logger.info(f"Received inbound call request: {request.values}")

        # Get the Twilio phone number that received the call
        to_number = request.values.get('To')
        call_sid = request.values.get('CallSid')

        logger.info(f"Inbound call to {to_number}, CallSid: {call_sid}")

        # If the number is in our mappings, use the associated workflow
        # Otherwise, check if workflow_id was provided in the URL
        workflow_id = request.args.get('workflow_id')
        system_prompt = "You are a helpful assistant. Provide concise and clear answers."

        logger.info(f"Initial workflow_id from URL: {workflow_id}")
        logger.info(f"Phone mappings: {phone_number_mappings}")

        if to_number in phone_number_mappings:
            mapping = phone_number_mappings[to_number]
            workflow_id = mapping['workflow_id']
            system_prompt = mapping.get('system_prompt', system_prompt)
            logger.info(f"Found mapping for {to_number} to workflow {workflow_id}")

        if not workflow_id:
            # No workflow found - provide error message
            logger.error("No workflow_id found for inbound call")
            response = VoiceResponse()
            response.say("I'm sorry, this phone number is not properly configured.", voice='alice')
            response.hangup()
            return str(response)

        # Initialize call state
        active_calls[call_sid] = {
            'workflow_id': workflow_id,
            'system_prompt': system_prompt,
            'conversation_history': [],
            'turn_count': 0,
            'inbound': True,
            'to_number': to_number
        }

        logger.info(f"Initialized call state for {call_sid}, proceeding to handle_call")

        # Create a direct response instead of redirecting
        return handle_call(call_sid, workflow_id)

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
    workflow_id = request.values.get('workflow_id')
    return handle_call(call_sid, workflow_id)

def handle_call(call_sid, workflow_id):
    """Common handler for both inbound and outbound calls"""
    try:
        logger.info(f"handle_call: processing call {call_sid} with workflow {workflow_id}")

        # Get or initialize call state
        if call_sid not in active_calls and workflow_id:
            active_calls[call_sid] = {
                'workflow_id': workflow_id,
                'system_prompt': "You are a helpful assistant. Provide concise and clear answers.",
                'conversation_history': [],
                'turn_count': 0
            }

        call_state = active_calls.get(call_sid, {})
        logger.info(f"Call state: {call_state}")

        # Create TwiML response
        response = VoiceResponse()

        # Check if this is a new call
        if call_state.get('turn_count', 0) == 0:
            # Initial greeting for new calls
            greeting = "Hello! I'm your RowBoat assistant. How can I help you today?"
            logger.info(f"New call, preparing greeting: {greeting}")

            # Import directly to ensure we're using the correct function
            from twilio_api import elevenlabs_client, text_to_speech
            logger.info("Generating speech with ElevenLabs")

            try:
                # Generate speech directly with ElevenLabs client
                logger.info("Calling ElevenLabs generate function")
                audio_generator = elevenlabs_client.generate(
                    text=greeting,
                    voice=TTS_VOICE,
                    model=TTS_MODEL,
                    output_format="mp3_44100_128"
                )

                # Convert generator to bytes
                logger.info("Converting audio generator to bytes")
                audio_bytes = b"".join(chunk for chunk in audio_generator)

                if audio_bytes:
                    logger.info(f"Got audio data: {len(audio_bytes)} bytes")
                    # Save audio to a temporary file
                    audio_filename = f"/tmp/greeting_{call_sid}.mp3"
                    with open(audio_filename, 'wb') as f:
                        f.write(audio_bytes)

                    # Get full URL for the audio file
                    base_url = request.host_url.rstrip('/')
                    audio_url = f"{base_url}/audio/{os.path.basename(audio_filename)}"
                    logger.info(f"Playing greeting from URL: {audio_url}")

                    # Play the greeting
                    response.play(audio_url)
                else:
                    logger.warning("ElevenLabs generated empty audio data")
                    response.say(greeting, voice='alice')
            except Exception as e:
                logger.error(f"Error with ElevenLabs TTS: {str(e)}")
                import traceback
                logger.error(traceback.format_exc())
                # Fallback to Twilio TTS
                response.say(greeting, voice='alice')

            # Update call state
            call_state['turn_count'] = 1
            active_calls[call_sid] = call_state

            # Gather user input after greeting
            gather = Gather(
                input='speech',
                action=f'/process_speech?call_sid={call_sid}',
                speech_timeout='auto',
                language='en-US'
            )
            response.append(gather)

            # If no input detected, retry
            response.redirect(f'/twiml?workflow_id={workflow_id}')

        logger.info(f"Returning TwiML response: {str(response)}")
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
        speech_result = request.values.get('SpeechResult')

        if not call_sid or not speech_result:
            logger.warning(f"Missing call_sid or speech result: {call_sid}, {speech_result}")
            response = VoiceResponse()
            response.say("I'm sorry, I didn't catch that. Could you please try again?", voice='alice')
            response.hangup()
            return str(response)

        if call_sid not in active_calls:
            logger.warning(f"Call SID not found in active calls: {call_sid}")
            response = VoiceResponse()
            response.say("I'm sorry, your call session has expired. Please call back.", voice='alice')
            response.hangup()
            return str(response)

        call_state = active_calls[call_sid]
        workflow_id = call_state['workflow_id']
        system_prompt = call_state['system_prompt']

        # Log user input
        logger.info(f"User input: {speech_result}")

        # Process with RowBoat agent
        try:
            ai_response = process_conversation_turn(
                user_input=speech_result,
                workflow_id=workflow_id,
                system_prompt=system_prompt
            )
            logger.info(f"RowBoat response: {ai_response}")
        except Exception as e:
            logger.error(f"Error processing with RowBoat: {str(e)}")
            ai_response = "I'm sorry, I encountered an issue processing your request. Could you please try again?"

        # Update conversation history
        call_state['conversation_history'].append({
            'user': speech_result,
            'assistant': ai_response
        })
        call_state['turn_count'] += 1
        active_calls[call_sid] = call_state

        # Create TwiML response
        response = VoiceResponse()

        # Generate speech with ElevenLabs for response
        logger.info("Generating ElevenLabs speech for response")

        try:
            # Import directly to ensure we're using the correct client
            from twilio_api import elevenlabs_client

            # Generate the speech directly with ElevenLabs
            logger.info("Calling ElevenLabs generate function for response")
            audio_generator = elevenlabs_client.generate(
                text=ai_response,
                voice=TTS_VOICE,
                model=TTS_MODEL,
                output_format="mp3_44100_128"
            )

            # Convert generator to bytes
            logger.info("Converting response audio generator to bytes")
            audio_bytes = b"".join(chunk for chunk in audio_generator)

            if audio_bytes:
                logger.info(f"Got response audio data: {len(audio_bytes)} bytes")
                # Save audio to a temporary file with unique name
                audio_filename = f"/tmp/response_{call_sid}_{uuid.uuid4()}.mp3"
                with open(audio_filename, 'wb') as f:
                    f.write(audio_bytes)

                # Get full URL for the audio file
                base_url = request.host_url.rstrip('/')
                audio_url = f"{base_url}/audio/{os.path.basename(audio_filename)}"
                logger.info(f"Playing response from URL: {audio_url}")

                # Play the response
                response.play(audio_url)
            else:
                logger.warning("ElevenLabs generated empty audio data for response")
                response.say("ERROR: ElevenLabs TTS failed", voice='alice')
        except Exception as e:
            logger.error(f"Error with ElevenLabs TTS for response: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            # Fallback to Twilio TTS
            response.say("ERROR: ElevenLabs TTS failed", voice='alice')

        # Gather next user input
        gather = Gather(
            input='speech',
            action=f'/process_speech?call_sid={call_sid}',
            speech_timeout='auto',
            language='en-US'
        )
        response.append(gather)

        # If no input detected, wait for more user input
        response.redirect(f'/twiml?workflow_id={workflow_id}')

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

@app.route('/audio/<filename>', methods=['GET'])
def serve_audio(filename):
    """Serve temporary audio files"""
    try:
        logger.info(f"Audio file requested: {filename}")
        file_path = f"/tmp/{filename}"

        if not os.path.exists(file_path):
            logger.error(f"Audio file not found: {file_path}")
            # List files in /tmp to debug
            tmp_files = os.listdir('/tmp')
            logger.info(f"Files in /tmp: {tmp_files}")
            return "Audio file not found", 404

        # Get file stats
        file_size = os.path.getsize(file_path)
        logger.info(f"Serving audio file: {file_path}, size: {file_size} bytes")

        with open(file_path, 'rb') as f:
            audio_data = f.read()

        response = Response(audio_data)
        response.headers['Content-Type'] = 'audio/mpeg'
        return response

    except Exception as e:
        # Log the full error with traceback
        import traceback
        logger.error(f"Error serving audio file: {str(e)}")
        logger.error(traceback.format_exc())
        return "Error serving audio file", 500

@app.route('/call-status', methods=['POST'])
def call_status_callback():
    """Handle call status callbacks from Twilio"""
    call_sid = request.values.get('CallSid')
    call_status = request.values.get('CallStatus')

    logger.info(f"Call {call_sid} status: {call_status}")

    # Clean up resources when call completes
    if call_status in ['completed', 'failed', 'busy', 'no-answer', 'canceled']:
        if call_sid in active_calls:
            # Save conversation history to a file for records before removing
            history_file = f"call_history_{call_sid}.json"
            with open(history_file, 'w') as f:
                json.dump(active_calls[call_sid], f, indent=2)

            # Remove from active calls
            del active_calls[call_sid]

            # Clean up temporary audio files
            for filename in os.listdir('/tmp'):
                if call_sid in filename and filename.endswith('.mp3'):
                    try:
                        os.remove(os.path.join('/tmp', filename))
                    except:
                        pass

    return '', 204

@app.route('/health', methods=['GET'])
def health_check():
    """Simple health check endpoint"""
    return jsonify({
        "status": "healthy",
        "active_calls": len(active_calls)
    })

if __name__ == '__main__':
    # Create tmp directory if it doesn't exist
    os.makedirs('/tmp', exist_ok=True)

    # Load saved phone number mappings
    load_phone_mappings()

    # Get port from environment or use default
    port = int(os.environ.get('PORT', 3009))

    # Log startup information
    logger.info(f"Starting Twilio-RowBoat server on port {port}")
    logger.info(f"Loaded {len(phone_number_mappings)} phone number mappings for inbound calls")

    # Run the Flask app
    app.run(host='0.0.0.0', port=port, debug=False)