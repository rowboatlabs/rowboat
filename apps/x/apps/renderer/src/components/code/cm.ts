import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import {
  HighlightStyle,
  LanguageDescription,
  bracketMatching,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { tags } from '@lezer/highlight'

// Shared CodeMirror setup for the Code section's read-only viewers
// (file viewer + diff viewer). Theming keys off the app's resolved theme
// instead of pulling in a theme package.

const darkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#c678dd' },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: '#e06c75' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: '#61afef' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: '#d19a66' },
  { tag: [tags.definition(tags.name), tags.separator], color: '#abb2bf' },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: '#e5c07b' },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: '#56b6c2' },
  { tag: [tags.meta, tags.comment], color: '#7d8799', fontStyle: 'italic' },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: '#d19a66' },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: '#98c379' },
  { tag: tags.invalid, color: '#ffffff' },
])

export function cmBaseExtensions(isDark: boolean): Extension[] {
  const bg = isDark ? '#0f1117' : '#ffffff'
  const panelBg = isDark ? '#151821' : '#f6f8fa'
  const text = isDark ? '#d4d4d8' : '#24292f'
  const muted = isDark ? '#7d8590' : '#6e7781'
  const border = isDark ? '#2f3542' : '#d0d7de'

  return [
    lineNumbers(),
    bracketMatching(),
    syntaxHighlighting(isDark ? darkHighlight : defaultHighlightStyle, { fallback: true }),
    EditorView.lineWrapping,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.theme(
      {
        '&': {
          backgroundColor: bg,
          color: text,
          fontSize: '12px',
          height: '100%',
        },
        '.cm-editor': {
          backgroundColor: bg,
          color: text,
        },
        '.cm-content': {
          caretColor: text,
        },
        '.cm-scroller': {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          overflow: 'auto',
        },
        '.cm-line': {
          color: text,
        },
        '.cm-gutters': {
          backgroundColor: panelBg,
          borderRight: `1px solid ${border}`,
          color: muted,
        },
        '.cm-activeLine': {
          backgroundColor: isDark ? 'rgba(110, 118, 129, 0.16)' : 'rgba(175, 184, 193, 0.18)',
        },
        '.cm-activeLineGutter': {
          backgroundColor: isDark ? 'rgba(110, 118, 129, 0.16)' : 'rgba(175, 184, 193, 0.18)',
        },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
          backgroundColor: isDark ? 'rgba(88, 166, 255, 0.32)' : 'rgba(9, 105, 218, 0.22)',
        },
        '.cm-panels, .cm-panel': {
          backgroundColor: panelBg,
          color: text,
          borderColor: border,
        },
        '.cm-mergeView': {
          backgroundColor: bg,
          color: text,
        },
        '.cm-mergeViewEditors': {
          backgroundColor: bg,
        },
        '.cm-mergeView .cm-editor': {
          borderColor: border,
        },
        '.cm-changedLine': {
          backgroundColor: isDark ? 'rgba(56, 139, 253, 0.14)' : 'rgba(9, 105, 218, 0.08)',
        },
        '.cm-deletedChunk': {
          backgroundColor: isDark ? 'rgba(248, 81, 73, 0.14)' : 'rgba(255, 235, 233, 0.95)',
        },
        '.cm-insertedLine, .cm-insertedChunk': {
          backgroundColor: isDark ? 'rgba(63, 185, 80, 0.14)' : 'rgba(234, 255, 234, 0.95)',
        },
        '&.cm-focused': { outline: 'none' },
        // GitHub-style expander bar for folded unchanged regions (@codemirror/merge).
        '.cm-collapsedLines': {
          backgroundColor: isDark ? 'rgba(56, 139, 253, 0.15)' : 'rgba(9, 105, 218, 0.08)',
          backgroundImage: 'none',
          color: isDark ? '#79c0ff' : '#0969da',
          padding: '4px 12px',
          fontSize: '11px',
          cursor: 'pointer',
        },
        '.cm-collapsedLines:hover': {
          backgroundColor: isDark ? 'rgba(56, 139, 253, 0.25)' : 'rgba(9, 105, 218, 0.15)',
        },
      },
      { dark: isDark },
    ),
  ]
}

// Resolve a language extension from the filename (lazy-loaded; Vite splits
// each language into its own chunk).
export async function cmLanguageFor(filename: string): Promise<Extension | null> {
  const desc = LanguageDescription.matchFilename(languages, filename)
  if (!desc) return null
  try {
    return await desc.load()
  } catch {
    return null
  }
}
