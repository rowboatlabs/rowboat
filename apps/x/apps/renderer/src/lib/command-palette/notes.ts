// Brain notes for the ⌘K palette, read off the workspace tree App already
// holds (the same tree the Brain view renders): every markdown note under
// knowledge/, newest first by the file's mtime. Folders with their own
// destinations elsewhere (Meetings, Workspace) stay out, as they do on the
// Brain overview.

export interface PaletteNote {
    path: string
    /** The file name without its extension. */
    title: string
    /** ISO time of the last write. */
    modifiedAt: string
}

/** The shape both App's and the Brain view's tree nodes satisfy. */
export interface NoteTreeNode {
    path: string
    name: string
    kind: 'file' | 'dir'
    children?: readonly NoteTreeNode[]
    stat?: { mtimeMs: number }
}

const ROOT = 'knowledge/'
const HIDDEN = ['knowledge/Meetings/', 'knowledge/Workspace/']

export function brainNotes(tree: readonly NoteTreeNode[]): PaletteNote[] {
    const out: PaletteNote[] = []
    const walk = (node: NoteTreeNode) => {
        if (node.kind === 'dir') {
            if (HIDDEN.some((h) => `${node.path}/` === h)) return
            for (const child of node.children ?? []) walk(child)
            return
        }
        if (!node.path.startsWith(ROOT) || !node.name.toLowerCase().endsWith('.md')) return
        if (HIDDEN.some((h) => node.path.startsWith(h))) return
        out.push({
            path: node.path,
            title: node.name.replace(/\.md$/i, ''),
            modifiedAt: new Date(node.stat?.mtimeMs ?? 0).toISOString(),
        })
    }
    for (const node of tree) walk(node)
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}
