import { MarkdownPreOverride } from '@/components/ai-elements/markdown-code-override'
import { defaultRemarkPlugins } from 'streamdown'
import remarkBreaks from 'remark-breaks'

/** Shared streamdown component overrides for chat markdown rendering. */
export const streamdownComponents = { pre: MarkdownPreOverride }

// Render user messages with markdown so bullets, bold, links, etc. survive the
// round-trip from the input textarea. `remarkBreaks` turns single newlines
// into <br> so typed line breaks are preserved without requiring blank lines.
export const userMessageRemarkPlugins = [...Object.values(defaultRemarkPlugins), remarkBreaks]
