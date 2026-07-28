/**
 * Knowledge sidebar tree: building, sorting, and flattening the file tree that
 * backs the knowledge/ pane.
 *
 * Extracted verbatim from App.tsx — pure functions, no React, no IPC.
 */

import z from 'zod'
import { workspace } from '@x/shared'

type DirEntry = z.infer<typeof workspace.DirEntry>

export interface TreeNode extends DirEntry {
  children?: TreeNode[]
  loaded?: boolean
}

// Sidebar folder ordering — listed folders appear in this order, unlisted ones follow alphabetically
export const FOLDER_ORDER = ['People', 'Organizations', 'Projects', 'Topics', 'Meetings', 'Agent Notes', 'Notes']

/**
 * Per-folder base view config: which columns to show and default sort.
 * Folders not listed here fall back to DEFAULT_BASE_CONFIG.
 */
export const FOLDER_BASE_CONFIGS: Record<string, { visibleColumns: string[]; sort: { field: string; dir: 'asc' | 'desc' } }> = {
  'Agent Notes': {
    visibleColumns: ['name', 'folder', 'mtimeMs'],
    sort: { field: 'mtimeMs', dir: 'desc' },
  },
  People: {
    visibleColumns: ['name', 'relationship', 'organization', 'mtimeMs'],
    sort: { field: 'name', dir: 'asc' },
  },
  Organizations: {
    visibleColumns: ['name', 'relationship', 'mtimeMs'],
    sort: { field: 'name', dir: 'asc' },
  },
  Projects: {
    visibleColumns: ['name', 'status', 'topic', 'mtimeMs'],
    sort: { field: 'name', dir: 'asc' },
  },
  Topics: {
    visibleColumns: ['name', 'mtimeMs'],
    sort: { field: 'name', dir: 'asc' },
  },
  Meetings: {
    visibleColumns: ['name', 'topic', 'mtimeMs'],
    sort: { field: 'mtimeMs', dir: 'desc' },
  },
}

// Sort nodes (dirs first, ordered folders by FOLDER_ORDER, then alphabetically)
export function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    const aOrder = FOLDER_ORDER.indexOf(a.name)
    const bOrder = FOLDER_ORDER.indexOf(b.name)
    if (aOrder !== -1 && bOrder !== -1) return aOrder - bOrder
    if (aOrder !== -1) return -1
    if (bOrder !== -1) return 1
    return a.name.localeCompare(b.name)
  }).map(node => {
    if (node.children) {
      node.children = sortNodes(node.children)
    }
    return node
  })
}

/**
 * Organize Meetings/ source folders into date-grouped subfolders.
 *
 * - rowboat:  rowboat/2026-03-20/meeting-xxx.md  → keeps date folders as-is
 * - granola:  granola/2026/03/18/Title.md         → collapses into "2026-03-18" folders
 * - Files directly under a source folder (no date subfolder) are grouped
 *   by the date prefix in their filename (e.g. meeting-2026-03-17T...).
 */
export function flattenMeetingsTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap(node => {
    if (node.kind !== 'dir' || node.name !== 'Meetings') return [node]

    const flattenedSourceChildren = (node.children ?? []).flatMap(sourceNode => {
      if (sourceNode.kind !== 'dir') return [sourceNode]

      // Collect all files with their date group label
      const dateGroups = new Map<string, TreeNode[]>()

      function collectFiles(n: TreeNode, dateParts: string[]) {
        for (const child of n.children ?? []) {
          if (child.kind === 'file') {
            const dateStr = dateParts.join('-')
            // If file is at root of source folder, try to extract date from filename
            const groupKey = dateStr || extractDateFromFilename(child.name) || 'other'
            const group = dateGroups.get(groupKey) ?? []
            group.push(child)
            dateGroups.set(groupKey, group)
          } else if (child.kind === 'dir') {
            collectFiles(child, [...dateParts, child.name])
          }
        }
      }
      collectFiles(sourceNode, [])

      // Pass through user-created folders that have no meeting-style date files
      if (dateGroups.size === 0) return [sourceNode]

      // Build date folder nodes, sorted reverse chronologically
      const dateFolderNodes: TreeNode[] = [...dateGroups.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([dateKey, files]) => {
          // Sort files within each date group reverse chronologically
          files.sort((a, b) => b.name.localeCompare(a.name))
          return {
            name: dateKey,
            path: `${sourceNode.path}/${dateKey}`,
            kind: 'dir' as const,
            children: files,
            loaded: true,
          }
        })

      return [{ ...sourceNode, children: dateFolderNodes }]
    })

    // Hide Meetings folder entirely if no source folders have files
    if (flattenedSourceChildren.length === 0) return []

    return [{ ...node, children: flattenedSourceChildren }]
  })
}

/** Extract YYYY-MM-DD from filenames like "meeting-2026-03-17T05-01-47.md" */
export function extractDateFromFilename(name: string): string | null {
  const match = name.match(/(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

// Build tree structure from flat entries
export function buildTree(entries: DirEntry[]): TreeNode[] {
  const treeMap = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  // Create nodes
  entries.forEach(entry => {
    const node: TreeNode = { ...entry, children: [], loaded: false }
    treeMap.set(entry.path, node)
  })

  // Build hierarchy
  entries.forEach(entry => {
    const node = treeMap.get(entry.path)!
    const parts = entry.path.split('/')
    if (parts.length === 1) {
      roots.push(node)
    } else {
      const parentPath = parts.slice(0, -1).join('/')
      const parent = treeMap.get(parentPath)
      if (parent) {
        if (!parent.children) parent.children = []
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    }
  })

  return sortNodes(roots)
}

export const collectDirPaths = (nodes: TreeNode[]): string[] =>
  nodes.flatMap(n => n.kind === 'dir' ? [n.path, ...(n.children ? collectDirPaths(n.children) : [])] : [])

export const collectFilePaths = (nodes: TreeNode[]): string[] =>
  nodes.flatMap(n => n.kind === 'file' ? [n.path] : (n.children ? collectFilePaths(n.children) : []))

export const getAncestorDirectoryPaths = (path: string): string[] => {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 2) return []
  const ancestors: string[] = []
  for (let i = 1; i < parts.length - 1; i++) {
    ancestors.push(parts.slice(0, i + 1).join('/'))
  }
  return ancestors
}
