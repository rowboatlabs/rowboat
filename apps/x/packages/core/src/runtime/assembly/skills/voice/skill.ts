export const skill = String.raw`
# Voice — Speak & Transcribe

Load this skill to generate spoken audio from text or transcribe audio files to text. Both tools ride the app's own voice stack — the same ElevenLabs (TTS) and Deepgram (ASR) credentials that power voice mode, or the signed-in Rowboat account. **The user never needs to add API keys for these.**

## The tools

### \`text-to-speech\` — text → spoken .mp3 in the workspace
- **\`text\`** (required, max 5000 chars) — what to say. For long content, synthesize one segment per call.
- **\`outputPath\`** (optional) — where to save the .mp3; defaults to \`media/tts/tts-<timestamp>.mp3\`.
- **\`voiceId\`** (optional) — an ElevenLabs voice id. Omit for the app's default voice.

Returns \`{ path, mimeType, bytes }\`. Tell the user where the file landed; they can play it from the workspace.

### \`transcribe-audio\` — audio file → text
- **\`path\`** (required) — the audio file (workspace-relative or absolute). Common formats work: wav, mp3, ogg/opus, webm.

Returns \`{ transcript }\`.

## Voices for dialogue / podcast-style audio

Use two distinct ElevenLabs premade voices across segments to voice different speakers:
- \`pNInz6obpgDQGcFmaJgB\` ("Adam", male)
- \`21m00Tcm4TlvDq8ikWAM\` ("Rachel", female)

Pattern for a two-host segment set:
1. Write the dialogue as short exchanges (≤ ~60 words each — snappy audio beats monologues).
2. Call \`text-to-speech\` once per exchange, alternating \`voiceId\`, with numbered \`outputPath\`s like \`media/podcast/segment-01.mp3\`.
3. If the user wants ONE file and \`ffmpeg\` is available via \`executeCommand\`, concatenate:
   \`ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp3\` (list.txt lines: \`file 'segment-01.mp3'\`…). Otherwise deliver the numbered segments.

## Notes
- Keep individual TTS calls short; synthesis time and cost scale with text length.
- Transcription of very long recordings takes a while — warn the user for files over ~30 minutes.
- Rowboat Apps have the same powers via their Host API (\`POST /_rowboat/voice/tts\` and \`POST /_rowboat/voice/transcribe\`, manifest capability \`"voice"\`) — see the \`apps\` skill when building an app that speaks or listens.
`;

export default skill;
