import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { Editor } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ChevronUpIcon,
  ChevronDownIcon,
  XIcon,
  ReplaceIcon,
} from 'lucide-react'

const findHighlightKey = new PluginKey('findHighlight')

type MatchRange = { from: number; to: number }

interface FindReplaceBarProps {
  editor: Editor
  onClose: () => void
}

export function FindReplaceBar({ editor, onClose }: FindReplaceBarProps) {
  const [query, setQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(-1)
  // Bump this to force match recomputation after document changes (replace)
  const [searchVersion, setSearchVersion] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const matchesRef = useRef<MatchRange[]>([])
  const currentIndexRef = useRef(-1)
  const pluginRegistered = useRef(false)

  // Compute matches from query + document (recomputed when searchVersion changes)
  const matches = useMemo(() => {
    if (!query) return []
    const results: MatchRange[] = []
    const lowerQuery = query.toLowerCase()
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        const text = node.text.toLowerCase()
        let idx = text.indexOf(lowerQuery)
        while (idx !== -1) {
          results.push({ from: pos + idx, to: pos + idx + query.length })
          idx = text.indexOf(lowerQuery, idx + 1)
        }
      }
    })
    return results
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, editor, searchVersion])

  // Reset currentIndex when matches change
  const prevMatchCountRef = useRef(0)
  useEffect(() => {
    if (matches.length !== prevMatchCountRef.current) {
      prevMatchCountRef.current = matches.length
      setCurrentIndex(matches.length > 0 ? 0 : -1)
    }
  }, [matches])

  // Keep refs in sync for the decoration plugin to read
  useEffect(() => {
    matchesRef.current = matches
    currentIndexRef.current = currentIndex
    // Force decoration re-render
    editor.view.dispatch(editor.state.tr)
  }, [matches, currentIndex, editor])

  // Register/unregister the decoration plugin
  useEffect(() => {
    const plugin = new Plugin({
      key: findHighlightKey,
      props: {
        decorations(state) {
          const currentMatches = matchesRef.current
          const idx = currentIndexRef.current
          if (currentMatches.length === 0) return DecorationSet.empty

          const decorations: Decoration[] = []
          for (let i = 0; i < currentMatches.length; i++) {
            const match = currentMatches[i]
            if (match.from < 0 || match.to > state.doc.content.size) continue
            const className = i === idx ? 'find-highlight find-highlight-current' : 'find-highlight'
            decorations.push(Decoration.inline(match.from, match.to, { class: className }))
          }

          return DecorationSet.create(state.doc, decorations)
        },
      },
    })

    editor.registerPlugin(plugin)
    pluginRegistered.current = true

    return () => {
      if (pluginRegistered.current) {
        editor.unregisterPlugin(findHighlightKey)
        pluginRegistered.current = false
        editor.view.dispatch(editor.state.tr)
      }
    }
  }, [editor])

  // Scroll current match into view
  useEffect(() => {
    if (currentIndex >= 0 && currentIndex < matches.length) {
      const match = matches[currentIndex]
      editor.commands.setTextSelection(match)
      // Use coordsAtPos to get the screen position, then scroll the
      // .editor-content-wrapper container so the match is visible.
      try {
        const coords = editor.view.coordsAtPos(match.from)
        const wrapper = editor.view.dom.closest('.editor-content-wrapper')
        if (wrapper) {
          const rect = wrapper.getBoundingClientRect()
          const relativeTop = coords.top - rect.top
          // If the match is outside the visible area, scroll to center it
          if (relativeTop < 0 || relativeTop > rect.height - 40) {
            wrapper.scrollTop += relativeTop - rect.height / 3
          }
        }
      } catch {
        // Fallback to ProseMirror's built-in scroll
        editor.commands.scrollIntoView()
      }
    }
  }, [currentIndex, matches, editor])

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }, [])

  const goToNext = useCallback(() => {
    if (matches.length === 0) return
    setCurrentIndex(prev => (prev + 1) % matches.length)
  }, [matches.length])

  const goToPrev = useCallback(() => {
    if (matches.length === 0) return
    setCurrentIndex(prev => (prev - 1 + matches.length) % matches.length)
  }, [matches.length])

  const handleReplace = useCallback(() => {
    if (currentIndex < 0 || currentIndex >= matches.length) return
    const match = matches[currentIndex]
    editor.chain().focus().insertContentAt(
      { from: match.from, to: match.to },
      replaceText
    ).run()
    setSearchVersion(v => v + 1)
  }, [currentIndex, matches, replaceText, editor])

  const handleReplaceAll = useCallback(() => {
    if (matches.length === 0) return
    const chain = editor.chain().focus()
    for (let i = matches.length - 1; i >= 0; i--) {
      chain.insertContentAt({ from: matches[i].from, to: matches[i].to }, replaceText)
    }
    chain.run()
    setSearchVersion(v => v + 1)
  }, [matches, replaceText, editor])

  const handleClose = useCallback(() => {
    onClose()
    editor.commands.focus()
  }, [onClose, editor])

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      goToPrev()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      goToNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleClose()
    }
  }

  const handleReplaceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      handleClose()
    }
  }

  return (
    <div className="find-replace-bar">
      <div className="find-replace-row">
        <Input
          ref={searchInputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Find..."
          className="find-replace-input"
        />
        <span className="find-replace-count">
          {matches.length > 0 ? `${currentIndex + 1} of ${matches.length}` : 'No results'}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="find-replace-btn"
          onClick={goToPrev}
          disabled={matches.length === 0}
          title="Previous match (Shift+Enter)"
        >
          <ChevronUpIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="find-replace-btn"
          onClick={goToNext}
          disabled={matches.length === 0}
          title="Next match (Enter)"
        >
          <ChevronDownIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="find-replace-btn"
          onClick={() => setShowReplace(prev => !prev)}
          title="Toggle replace"
          data-active={showReplace || undefined}
        >
          <ReplaceIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="find-replace-btn"
          onClick={handleClose}
          title="Close (Escape)"
        >
          <XIcon className="h-4 w-4" />
        </Button>
      </div>
      {showReplace && (
        <div className="find-replace-row">
          <Input
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            placeholder="Replace..."
            className="find-replace-input"
          />
          <Button
            variant="ghost"
            size="sm"
            className="find-replace-action-btn"
            onClick={handleReplace}
            disabled={matches.length === 0}
          >
            Replace
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="find-replace-action-btn"
            onClick={handleReplaceAll}
            disabled={matches.length === 0}
          >
            All
          </Button>
        </div>
      )}
    </div>
  )
}
