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

@app.route('/api/phone-numbers', methods=['POST'])
def api_provision_number():
    """API endpoint to provision a new Twilio phone number"""
    data = request.json or {}
    area_code = data.get('area_code')
    country_code = data.get('country_code', 'US')
    
    result = provision_phone_number(area_code, country_code)
    return jsonify(result)

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

@app.route('/twiml', methods=['POST'])
def handle_call():
    """TwiML endpoint to handle incoming call interactions"""
    # Get call parameters
    call_sid = request.values.get('CallSid')
    workflow_id = request.values.get('workflow_id')
    
    # Get or initialize call state
    if call_sid not in active_calls and workflow_id:
        active_calls[call_sid] = {
            'workflow_id': workflow_id,
            'system_prompt': "You are a helpful assistant. Provide concise and clear answers.",
            'conversation_history': [],
            'turn_count': 0
        }
    
    call_state = active_calls.get(call_sid, {})
    
    # Create TwiML response
    response = VoiceResponse()
    
    # Check if this is a new call
    if call_state.get('turn_count', 0) == 0:
        # Initial greeting for new calls
        greeting = "Hello! I'm your RowBoat assistant. How can I help you today?"
        
        # Generate speech audio using ElevenLabs
        greeting_audio = text_to_speech(greeting)
        
        if greeting_audio:
            # Save audio to a temporary file
            audio_filename = f"/tmp/greeting_{call_sid}.mp3"
            with open(audio_filename, 'wb') as f:
                f.write(greeting_audio)
            
            # Play the greeting
            response.play(f"{request.host_url.rstrip('/')}/audio/{os.path.basename(audio_filename)}")
        else:
            # Fallback to TTS if ElevenLabs fails
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
        
    return str(response)

@app.route('/process_speech', methods=['POST'])
def process_speech():
    """Process user speech input and generate AI response"""
    call_sid = request.args.get('call_sid')
    speech_result = request.values.get('SpeechResult')
    
    if not call_sid or not speech_result or call_sid not in active_calls:
        response = VoiceResponse()
        response.say("I'm sorry, I couldn't process that request.", voice='alice')
        response.hangup()
        return str(response)
    
    call_state = active_calls[call_sid]
    workflow_id = call_state['workflow_id']
    system_prompt = call_state['system_prompt']
    
    # Log user input
    logger.info(f"User input: {speech_result}")
    
    # Process with RowBoat agent
    ai_response = process_conversation_turn(
        user_input=speech_result,
        workflow_id=workflow_id,
        system_prompt=system_prompt
    )
    
    # Update conversation history
    call_state['conversation_history'].append({
        'user': speech_result,
        'assistant': ai_response
    })
    call_state['turn_count'] += 1
    active_calls[call_sid] = call_state
    
    # Create TwiML response
    response = VoiceResponse()
    
    # Generate speech from AI response using ElevenLabs
    ai_audio = text_to_speech(ai_response)
    
    if ai_audio:
        # Save audio to a temporary file
        audio_filename = f"/tmp/response_{call_sid}_{uuid.uuid4()}.mp3"
        with open(audio_filename, 'wb') as f:
            f.write(ai_audio)
        
        # Play the AI response
        response.play(f"{request.host_url.rstrip('/')}/audio/{os.path.basename(audio_filename)}")
    else:
        # Fallback to TTS if ElevenLabs fails
        response.say(ai_response, voice='alice')
    
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
    
    return str(response)

@app.route('/audio/<filename>', methods=['GET'])
def serve_audio(filename):
    """Serve temporary audio files"""
    file_path = f"/tmp/{filename}"
    
    if not os.path.exists(file_path):
        return "Audio file not found", 404
        
    with open(file_path, 'rb') as f:
        audio_data = f.read()
    
    response = Response(audio_data)
    response.headers['Content-Type'] = 'audio/mpeg'
    return response

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
    
    # Get port from environment or use default
    port = int(os.environ.get('PORT', 3009))
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=port, debug=False)