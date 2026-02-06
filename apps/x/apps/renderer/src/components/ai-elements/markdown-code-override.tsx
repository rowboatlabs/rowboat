import { isValidElement, type JSX } from 'react'
import { FilePathCard } from './file-path-card'

export function MarkdownPreOverride(props: JSX.IntrinsicElements['pre']) {
  const { children, ...rest } = props

  // Check if the child is a <code> with className "language-filepath"
  if (isValidElement(children)) {
    const childProps = children.props as { className?: string; children?: unknown }
    if (
      typeof childProps.className === 'string' &&
      childProps.className.includes('language-filepath')
    ) {
      // Extract the text content from the code element
      const text = typeof childProps.children === 'string'
        ? childProps.children.trim()
        : ''
      if (text) {
        return <FilePathCard filePath={text} />
      }
    }
  }

  // Passthrough for all other code blocks - return children directly
  // so Streamdown's own rendering (syntax highlighting, etc.) is preserved
  return <pre {...rest}>{children}</pre>
}
