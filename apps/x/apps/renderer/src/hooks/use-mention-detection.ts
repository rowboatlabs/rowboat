import { useState, useEffect, useCallback, type RefObject } from 'react'
import { getCaretCoordinates, type CaretCoordinates } from '@/lib/textarea-caret'

export interface ActiveMention {
  query: string
  triggerIndex: number
}

export interface UseMentionDetectionResult {
  activeMention: ActiveMention | null
  cursorCoords: CaretCoordinates | null
}

/**
 * Hook that detects when a user types @ in a textarea and provides
 * the query string and cursor coordinates for showing a mention popover.
 */
export function useMentionDetection(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  enabled: boolean
): UseMentionDetectionResult {
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(null)
  const [cursorCoords, setCursorCoords] = useState<CaretCoordinates | null>(null)

  const detectMention = useCallback(() => {
    if (!enabled) {
      setActiveMention(null)
      setCursorCoords(null)
      return
    }

    const textarea = textareaRef.current
    if (!textarea) {
      setActiveMention(null)
      setCursorCoords(null)
      return
    }

    const cursorPos = textarea.selectionStart
    const textBeforeCursor = value.substring(0, cursorPos)

    // Find the last @ symbol before cursor
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')

    if (lastAtIndex === -1) {
      setActiveMention(null)
      setCursorCoords(null)
      return
    }

    // Check if @ is the start of an email (has non-whitespace before it)
    if (lastAtIndex > 0) {
      const charBefore = textBeforeCursor[lastAtIndex - 1]
      // If char before @ is not whitespace or newline, it's likely an email
      if (charBefore && !/[\s\n]/.test(charBefore)) {
        setActiveMention(null)
        setCursorCoords(null)
        return
      }
    }

    // Get text between @ and cursor
    const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1)

    // If there's a space or newline after @, the mention is closed
    if (/[\s\n]/.test(textAfterAt)) {
      setActiveMention(null)
      setCursorCoords(null)
      return
    }

    // We have an active mention
    const query = textAfterAt
    setActiveMention({
      query,
      triggerIndex: lastAtIndex,
    })

    // Calculate cursor coordinates
    const coords = getCaretCoordinates(textarea, lastAtIndex)
    setCursorCoords(coords)
  }, [textareaRef, value, enabled])

  // Detect mention on value or cursor position change
  useEffect(() => {
    detectMention()
  }, [detectMention])

  // Also detect on selection change (cursor movement)
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || !enabled) return

    const handleSelectionChange = () => {
      detectMention()
    }

    // Listen for selection changes
    document.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [textareaRef, enabled, detectMention])

  return {
    activeMention,
    cursorCoords,
  }
}
