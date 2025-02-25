from rowboat import Client, StatefulChat
from typing import List
import json
import os
from openai import OpenAI
from deepgram import Deepgram
import elevenlabs
from deepgram import DeepgramClient, LiveTranscriptionEvents, LiveOptions
import queue
import threading
import time
from deepgram.audio.microphone import Microphone


openai_client = OpenAI()
MODEL_NAME = "gpt-4o"
ROWBOAT_API_HOST = os.environ.get("ROWBOAT_API_HOST", "http://127.0.0.1:3000").strip()

# Initialize Deepgram and ElevenLabs clients with API keys from environment variables
DEEPGRAM_API_KEY = "99bc0dbdf0dd742c80e458ba616b727c3819b004" #os.environ.get("DEEPGRAM_API_KEY")
ELEVENLABS_API_KEY = "b37f6f3ceaca6f8999d8ea3c31d5e4bd" #os.environ.get("ELEVENLABS_API_KEY")


deepgram: DeepgramClient = DeepgramClient(api_key=DEEPGRAM_API_KEY)
elevenlabs_client = elevenlabs.ElevenLabs(api_key=ELEVENLABS_API_KEY)


def transcription_thread_func(transcription_queue, stop_event, ignore_flag):
    """
    Runs in a separate thread to handle real-time transcription using Deepgram.
    Accumulates transcriptions until an utterance end is detected, then sends the
    complete transcription to the queue.
    
    Args:
        transcription_queue: Queue to send transcriptions to
        stop_event: Event to signal thread termination
        ignore_flag: Shared threading.Event to indicate when to ignore speech
    """
    dg_connection = deepgram.listen.websocket.v("1")

    buffer = []

    def on_open(self, open, **kwargs):
        print(f"\n\n{open}\n\n")

    def on_message(self, result, **kwargs):
        """
        Handles incoming transcriptions. Accumulates final transcriptions in a buffer.
        Ignores speech when the ignore_flag is set.
        """
        # Skip processing if we're in ignore mode
        if ignore_flag.is_set():
            return
            
        if result.is_final:
            sentence = result.channel.alternatives[0].transcript
            if len(sentence) > 0:
                buffer.append(sentence)

    def on_utterance_end(self, utterance_end, **kwargs):
        """
        When an utterance end is detected, combines the buffered transcriptions
        and sends them to the queue. Ignores if flag is set.
        """
        # Skip processing if we're in ignore mode
        if ignore_flag.is_set():
            buffer.clear()
            return
            
        if buffer:
            user_input = " ".join(buffer)
            transcription_queue.put(user_input)
            buffer.clear()

    def on_metadata(self, metadata, **kwargs):
        print(f"\n\n{metadata}\n\n")

    def on_speech_started(self, speech_started, **kwargs):
        print(f"\n\n{speech_started}\n\n")

    def on_error(self, error, **kwargs):
        print(f"\n\n{error}\n\n")

    def on_close(self, close, **kwargs):
        print(f"\n\n{close}\n\n")

    # Attach event handlers to the Deepgram connection
    dg_connection.on(LiveTranscriptionEvents.Open, on_open)
    dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
    dg_connection.on(LiveTranscriptionEvents.UtteranceEnd, on_utterance_end)
    dg_connection.on(LiveTranscriptionEvents.Metadata, on_metadata)
    dg_connection.on(LiveTranscriptionEvents.SpeechStarted, on_speech_started)
    dg_connection.on(LiveTranscriptionEvents.Error, on_error)
    dg_connection.on(LiveTranscriptionEvents.Close, on_close)

    # Configure transcription options
    options: LiveOptions = LiveOptions(
        model="nova-3",
        punctuate=True,
        language="en-US",
        encoding="linear16",
        channels=1,
        sample_rate=16000,
        interim_results=True,
        utterance_end_ms="1000",
        vad_events=True,
    )

    # Start the Deepgram connection
    dg_connection.start(options)

    # Start the microphone (assumes Microphone class is implemented)
    microphone = Microphone(dg_connection.send)
    microphone.start()

    # Run until the stop event is set
    while not stop_event.is_set():
        time.sleep(0.1)  # Small sleep to avoid busy waiting

    # Cleanup
    microphone.finish()
    dg_connection.finish()

def speak_to_support(rowboat_client: Client, workflow_id: str, max_iterations: int = 5, 
                     ignore_speech_during_processing: bool = False) -> tuple[str, str, str]:
    """
    Handles a conversational support session using real-time transcription and TTS.
    
    Args:
        rowboat_client (Client): The Rowboat client for chat functionality.
        workflow_id (str): The workflow ID for the chat session.
        max_iterations (int): Maximum number of conversational turns (default: 5).
        ignore_speech_during_processing (bool): If True, ignores user speech during 
                                               AI processing and TTS playback (default: False).
    
    Returns:
        tuple[str, str, str]: Last user input, last assistant response, and workflow ID.
    """
    support_chat = StatefulChat(
        rowboat_client,
        system_prompt="Help the user out with their issue",
        workflow_id=workflow_id
    )

    # Initialize transcription queue and control events
    transcription_queue = queue.Queue()
    stop_transcription = threading.Event()
    ignore_speech = threading.Event()  # New event to control when to ignore speech
    
    transcription_thread = threading.Thread(
        target=transcription_thread_func,
        args=(transcription_queue, stop_transcription, ignore_speech)
    )
    transcription_thread.start()

    last_user_input = ""
    last_rowboat_response = ""

    # Main conversational loop
    for i in range(max_iterations):
        try:
            # Wait for user input from the transcription queue (timeout after 30 seconds)
            user_input = transcription_queue.get(timeout=30)
            last_user_input = user_input
            
            # Set ignore flag if needed
            if ignore_speech_during_processing:
                ignore_speech.set()
                
            # Process user input through the chat system
            rowboat_response = support_chat.run(user_input)
            last_rowboat_response = rowboat_response

            try:
                # Convert the response to speech using ElevenLabs
                audio = elevenlabs_client.generate(
                    text=rowboat_response,
                    voice="Rachel",
                    model="eleven_monolingual_v1",
                    output_format="mp3_44100_128"
                )
                
                # Play the generated audio
                elevenlabs.play(audio)
                
            except Exception as e:
                print(f"Error with ElevenLabs TTS: {e}")
                # Fallback to printing the response if audio fails
                print(rowboat_response)
            
            # Clear ignore flag after processing and TTS are complete
            if ignore_speech_during_processing:
                ignore_speech.clear()
                
        except queue.Empty:
            print("No user input received within timeout")
            break

    # Stop the transcription thread
    stop_transcription.set()
    transcription_thread.join()

    return last_user_input, last_rowboat_response, workflow_id

if __name__ == "__main__":
    client = Client(
        host=ROWBOAT_API_HOST,
        project_id="faf2bfb3-41d4-4299-b0d2-048581ea9bd8",
        api_key="3f95055836f77714298a6d0d69f4a4cd1119bf979b341cceb96e9cdba4a6df15"
    )
    # Use the new parameter to enable ignoring speech during processing
    speak_to_support(client, "67b5da9e3ae58f110bc195bf", ignore_speech_during_processing=True)