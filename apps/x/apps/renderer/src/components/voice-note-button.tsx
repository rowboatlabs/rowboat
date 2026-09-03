"use client"

import * as React from "react"
import { Mic, Square } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "@/lib/toast"

async function transcribeWithDeepgram(audioBlob: Blob): Promise<string | null> {
  try {
    const configResult = await window.ipc.invoke('workspace:readFile', {
      path: 'config/deepgram.json',
      encoding: 'utf8',
    })
    const { apiKey } = JSON.parse(configResult.data) as { apiKey: string }
    if (!apiKey) throw new Error('No apiKey in deepgram.json')

    const response = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': audioBlob.type,
        },
        body: audioBlob,
      },
    )

    if (!response.ok) throw new Error(`Deepgram API error: ${response.status}`)
    const result = await response.json()
    return result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? null
  } catch (err) {
    console.error('Deepgram transcription failed:', err)
    return null
  }
}

// Voice Note Recording Button
export function VoiceNoteButton({ onNoteCreated, variant = 'icon' }: { onNoteCreated?: (path: string) => void; variant?: 'icon' | 'action' }) {
  const [isRecording, setIsRecording] = React.useState(false)
  const [hasDeepgramKey, setHasDeepgramKey] = React.useState(false)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const notePathRef = React.useRef<string | null>(null)
  const timestampRef = React.useRef<string | null>(null)
  const relativePathRef = React.useRef<string | null>(null)
  // Keep a ref to always call the latest onNoteCreated (avoids stale closure in recorder.onstop)
  const onNoteCreatedRef = React.useRef(onNoteCreated)
  React.useEffect(() => { onNoteCreatedRef.current = onNoteCreated }, [onNoteCreated])

  React.useEffect(() => {
    window.ipc.invoke('workspace:readFile', {
      path: 'config/deepgram.json',
      encoding: 'utf8',
    }).then((result: { data: string }) => {
      const { apiKey } = JSON.parse(result.data) as { apiKey: string }
      setHasDeepgramKey(!!apiKey)
    }).catch(() => {
      setHasDeepgramKey(false)
    })
  }, [])

  const startRecording = async () => {
    try {
      // Generate timestamp and paths immediately
      const now = new Date()
      const timestamp = now.toISOString().replace(/[:.]/g, '-')
      const dateStr = now.toISOString().split('T')[0] // YYYY-MM-DD
      const noteName = `voice-memo-${timestamp}`
      const notePath = `knowledge/Voice Memos/${dateStr}/${noteName}.md`

      timestampRef.current = timestamp
      notePathRef.current = notePath
      // Relative path for linking (from knowledge/ root, without .md extension)
      const relativePath = `Voice Memos/${dateStr}/${noteName}`
      relativePathRef.current = relativePath

      // Create the note immediately with a "Recording..." placeholder
      await window.ipc.invoke('workspace:mkdir', {
        path: `knowledge/Voice Memos/${dateStr}`,
        recursive: true,
      })

      const initialContent = `---
type: voice memo
recorded: "${now.toISOString()}"
path: ${relativePath}
---
# Voice Memo

## Transcript

*Recording in progress...*
`
      await window.ipc.invoke('workspace:writeFile', {
        path: notePath,
        data: initialContent,
        opts: { encoding: 'utf8' },
      })

      // Select the note so the user can see it
      onNoteCreatedRef.current?.(notePath)

      // Start actual recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const ext = mimeType === 'audio/mp4' ? 'm4a' : 'webm'
        const audioFilename = `voice-memo-${timestampRef.current}.${ext}`

        // Save audio file to voice_memos folder (for backup/reference)
        try {
          await window.ipc.invoke('workspace:mkdir', {
            path: 'voice_memos',
            recursive: true,
          })

          const arrayBuffer = await blob.arrayBuffer()
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              '',
            ),
          )

          await window.ipc.invoke('workspace:writeFile', {
            path: `voice_memos/${audioFilename}`,
            data: base64,
            opts: { encoding: 'base64' },
          })
        } catch {
          console.error('Failed to save audio file')
        }

        // Update note to show transcribing status
        const currentNotePath = notePathRef.current
        const currentRelativePath = relativePathRef.current
        if (currentNotePath && currentRelativePath) {
          const transcribingContent = `---
type: voice memo
recorded: "${new Date().toISOString()}"
path: ${currentRelativePath}
---
# Voice Memo

## Transcript

*Transcribing...*
`
          await window.ipc.invoke('workspace:writeFile', {
            path: currentNotePath,
            data: transcribingContent,
            opts: { encoding: 'utf8' },
          })
        }

        // Transcribe and update the note with the transcript
        const transcript = await transcribeWithDeepgram(blob)
        if (currentNotePath && currentRelativePath) {
          const finalContent = transcript
            ? `---
type: voice memo
recorded: "${new Date().toISOString()}"
path: ${currentRelativePath}
---
# Voice Memo

## Transcript

${transcript}
`
            : `---
type: voice memo
recorded: "${new Date().toISOString()}"
path: ${currentRelativePath}
---
# Voice Memo

## Transcript

*Transcription failed. Please try again.*
`
          await window.ipc.invoke('workspace:writeFile', {
            path: currentNotePath,
            data: finalContent,
            opts: { encoding: 'utf8' },
          })

          // Re-select to trigger refresh
          onNoteCreatedRef.current?.(currentNotePath)

          if (transcript) {
            toast('Voice note transcribed', 'success')
          } else {
            toast('Transcription failed', 'error')
          }
        }
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      toast('Recording started', 'success')
    } catch {
      toast('Could not access microphone', 'error')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null
    setIsRecording(false)
  }

  if (!hasDeepgramKey) return null

  const actionClass = "flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
  const iconClass = "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded p-1.5 transition-colors"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          className={variant === 'action' ? actionClass : iconClass}
          aria-label={isRecording ? 'Stop recording' : 'New voice note'}
        >
          {isRecording ? (
            <Square className="size-4 fill-red-500 text-red-500 animate-pulse" />
          ) : (
            <Mic className="size-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isRecording ? 'Stop Recording' : 'New Voice Note'}
      </TooltipContent>
    </Tooltip>
  )
}

