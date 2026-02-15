import { isValidElement, type JSX } from 'react'
import { FilePathCard } from './file-path-card'
import { HtmlPreview } from './html-preview'

/** Extract text content from a code element's children (may be string or nested spans from syntax highlighting). */
function extractText(children: unknown): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(extractText).join('')
  if (isValidElement(children)) {
    const props = children.props as { children?: unknown }
    return extractText(props.children)
  }
  return ''
}

export function MarkdownPreOverride(props: JSX.IntrinsicElements['pre']) {
  const { children, ...rest } = props

  if (isValidElement(children)) {
    const childProps = children.props as { className?: string; children?: unknown }

    if (typeof childProps.className === 'string') {
      // File-path cards
      if (childProps.className.includes('language-filepath')) {
        const text = extractText(childProps.children).trim()
        if (text) return <FilePathCard filePath={text} />
      }

      // HTML live preview
      if (childProps.className.includes('language-html')) {
        const text = extractText(childProps.children).trim()
        if (text) return <HtmlPreview code={text} />
      }
    }
  }

  // Passthrough for all other code blocks - return children directly
  // so Streamdown's own rendering (syntax highlighting, etc.) is preserved
  return <pre {...rest}>{children}</pre>
}
