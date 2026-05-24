import { InputRule, Node, mergeAttributes } from '@tiptap/core'
import { ensureMarkdownExtension, normalizeWikiPath, splitWikiAlias, splitWikiFragment, wikiLabel } from '@/lib/wiki-links'

const wikiLinkInputRegex = /\[\[([^[\]]+)\]\]$/
const wikiLinkTokenRegex = /\[\[([^[\]]+)\]\]/g

type WikiLinkOptions = {
  onCreate?: (path: string) => void
}

const isInsideCode = (textNode: Text) =>
  Boolean(textNode.parentElement?.closest('code, pre, a, wiki-link'))

const replaceWikiLinksInTextNode = (textNode: Text) => {
  const text = textNode.nodeValue
  if (!text || !text.includes('[[')) return
  if (isInsideCode(textNode)) return

  const matches = [...text.matchAll(wikiLinkTokenRegex)]
  if (!matches.length) return

  const fragment = document.createDocumentFragment()
  let lastIndex = 0

  for (const match of matches) {
    const matchIndex = match.index ?? 0
    const matchText = match[0] ?? ''
    const rawLink = match[1]?.trim() ?? ''
    const { label } = splitWikiAlias(rawLink)
    const normalizedPath = rawLink ? normalizeWikiPath(rawLink) : ''
    const { path: basePath, heading } = splitWikiFragment(normalizedPath)
    const isHeadingOnlyLink = !basePath && Boolean(heading)
    const isValidPath = isHeadingOnlyLink || (normalizedPath && !basePath.endsWith('/') && !basePath.includes('..'))

    if (matchIndex > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)))
    }

    if (isValidPath) {
      const el = document.createElement('wiki-link')
      el.setAttribute('data-path', isHeadingOnlyLink ? normalizedPath : ensureMarkdownExtension(normalizedPath))
      if (label) el.setAttribute('data-label', label)
      fragment.appendChild(el)
    } else {
      fragment.appendChild(document.createTextNode(matchText))
    }

    lastIndex = matchIndex + matchText.length
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
  }

  textNode.parentNode?.replaceChild(fragment, textNode)
}

const replaceWikiLinksInTextNodes = (root: HTMLElement) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text)
  }

  textNodes.forEach(replaceWikiLinksInTextNode)
}

export const WikiLink = Node.create<WikiLinkOptions>({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addOptions() {
    return {
      onCreate: undefined,
    }
  },

  addAttributes() {
    return {
      path: {
        default: '',
      },
      label: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'wiki-link[data-path]',
        getAttrs: (element: Element) => ({
          path: (element as HTMLElement).getAttribute('data-path') ?? '',
          label: (element as HTMLElement).getAttribute('data-label'),
        }),
      },
      {
        tag: 'a[data-type="wiki-link"]',
        getAttrs: (element: Element) => ({
          path: (element as HTMLElement).getAttribute('data-path') ?? '',
          label: (element as HTMLElement).getAttribute('data-label'),
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = node.attrs.label || wikiLabel(node.attrs.path) || node.attrs.path
    return [
      'a',
      mergeAttributes(
        HTMLAttributes,
        {
          'data-type': 'wiki-link',
          'data-path': node.attrs.path,
          'href': '#',
          'class': 'wiki-link',
          'aria-label': node.attrs.path,
        },
        node.attrs.label ? { 'data-label': node.attrs.label } : {}
      ),
      label,
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void }, node: { attrs: { path?: string } }) {
          const path = node.attrs.path ?? ''
          const label = (node.attrs as { label?: string }).label
          state.write(`[[${path}${label ? `|${label}` : ''}]]`)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            replaceWikiLinksInTextNodes(element)
          },
        },
      },
    }
  },

  addInputRules() {
    const onCreate = this.options.onCreate
    return [
      new InputRule({
        find: wikiLinkInputRegex,
        handler: ({ state, range, match }) => {
          const rawLink = match[1]?.trim()
          const { label } = splitWikiAlias(rawLink ?? '')
          const normalizedPath = rawLink ? normalizeWikiPath(rawLink) : ''
          const { path: basePath, heading } = splitWikiFragment(normalizedPath)
          const isHeadingOnlyLink = !basePath && Boolean(heading)
          if (
            !normalizedPath
            || (!isHeadingOnlyLink && (basePath.endsWith('/') || basePath.includes('..')))
          ) return null
          if (state.selection.$from.parent.type.spec.code) return null
          if (state.selection.$from.marks().some((mark) => mark.type.spec.code)) return null

          const finalPath = isHeadingOnlyLink ? normalizedPath : ensureMarkdownExtension(normalizedPath)
          state.tr.replaceWith(range.from, range.to, this.type.create({ path: finalPath, label }))
          onCreate?.(finalPath)
        },
      }),
    ]
  },
})
