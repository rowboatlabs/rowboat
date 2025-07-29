'use client';

import { useState, useRef, useCallback } from 'react';

export interface UseVoiceModeOptions {
  onTranscriptionComplete?: (text: string) => void;
  onTTSComplete?: () => void;
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;
}

export interface UseVoiceModeReturn {
  isListening: boolean;
  isSpeaking: boolean;
  isSupported: boolean;
  error: string | null;
  startListening: () => Promise<void>;
  stopListening: () => void;
  speakText: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  clearError: () => void;
}

export function useVoiceMode({
  onTranscriptionComplete,
  onTTSComplete,
  elevenLabsApiKey,
  elevenLabsVoiceId = 'pNInz6obpgDQGcFmaJgB' // Default voice ID
}: UseVoiceModeOptions = {}): UseVoiceModeReturn {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Check if browser supports speech recognition
  const isSupported = typeof window !== 'undefined' && 
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const startListening = useCallback(async () => {
    if (!isSupported) {
      setError('Speech recognition is not supported in this browser');
      return;
    }

    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      
      recognition.onstart = () => {
        setIsListening(true);
        setError(null);
      };
      
      recognition.onresult = (event) => {
        const transcript = event.results[0]?.[0]?.transcript;
        if (transcript) {
          onTranscriptionComplete?.(transcript);
        }
      };
      
      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setError(`Speech recognition error: ${event.error}`);
        setIsListening(false);
      };
      
      recognition.onend = () => {
        setIsListening(false);
      };
      
      recognitionRef.current = recognition;
      recognition.start();
      
    } catch (err) {
      setError('Failed to access microphone. Please check permissions.');
      setIsListening(false);
    }
  }, [isSupported, onTranscriptionComplete]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  }, []);

  const speakText = useCallback(async (text: string) => {
    try {
      setIsSpeaking(true);
      setError(null);
      
      // Stop any current audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      // Use text as-is since it's already processed by the caller
      const textToSpeak = text.trim();
      
      if (!textToSpeak) {
        setIsSpeaking(false);
        onTTSComplete?.();
        return;
      }

      if (elevenLabsApiKey) {
        // Use ElevenLabs API
        const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + elevenLabsVoiceId, {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': elevenLabsApiKey,
          },
          body: JSON.stringify({
            text: textToSpeak,
            model_id: 'eleven_monolingual_v1',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.5
            }
          })
        });

        if (!response.ok) {
          throw new Error(`ElevenLabs API error: ${response.status}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        
        audio.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          onTTSComplete?.();
        };
        
        audio.onerror = () => {
          setError('Failed to play audio');
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
        };
        
        audioRef.current = audio;
        await audio.play();
        
      } else {
        // Fallback to browser's built-in speech synthesis
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = 0.9;
        utterance.pitch = 1;
        
        utterance.onend = () => {
          setIsSpeaking(false);
          onTTSComplete?.();
        };
        
        utterance.onerror = () => {
          setError('Failed to synthesize speech');
          setIsSpeaking(false);
        };
        
        speechSynthesis.speak(utterance);
      }
      
    } catch (err) {
      console.error('TTS Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to synthesize speech');
      setIsSpeaking(false);
    }
  }, [elevenLabsApiKey, elevenLabsVoiceId, onTTSComplete]);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  return {
    isListening,
    isSpeaking,
    isSupported,
    error,
    startListening,
    stopListening,
    speakText,
    stopSpeaking,
    clearError
  };
}