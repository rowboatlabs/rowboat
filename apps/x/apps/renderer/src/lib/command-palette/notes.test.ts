import { describe, expect, it } from 'vitest'
import { brainNotes, type NoteTreeNode } from './notes'

const at = (days: number) => ({ mtimeMs: Date.UTC(2026, 8, 1 + days) })

const tree: NoteTreeNode[] = [
    {
        path: 'knowledge', name: 'knowledge', kind: 'dir',
        children: [
            { path: 'knowledge/roadmap.md', name: 'roadmap.md', kind: 'file', stat: at(3) },
            { path: 'knowledge/Ideas.MD', name: 'Ideas.MD', kind: 'file', stat: at(9) },
            { path: 'knowledge/data.csv', name: 'data.csv', kind: 'file', stat: at(10) },
            {
                path: 'knowledge/projects', name: 'projects', kind: 'dir',
                children: [{ path: 'knowledge/projects/palette.md', name: 'palette.md', kind: 'file', stat: at(5) }],
            },
            {
                path: 'knowledge/Meetings', name: 'Meetings', kind: 'dir',
                children: [{ path: 'knowledge/Meetings/standup.md', name: 'standup.md', kind: 'file', stat: at(11) }],
            },
            { path: 'knowledge/Workspace', name: 'Workspace', kind: 'dir', children: [{ path: 'knowledge/Workspace/x.md', name: 'x.md', kind: 'file', stat: at(12) }] },
        ],
    },
    { path: 'storage', name: 'storage', kind: 'dir', children: [{ path: 'storage/notes.md', name: 'notes.md', kind: 'file', stat: at(20) }] },
]

describe('brainNotes', () => {
    it('lists markdown notes under knowledge/, newest first, without the folders that live elsewhere', () => {
        expect(brainNotes(tree).map((n) => n.path)).toEqual([
            'knowledge/Ideas.MD',
            'knowledge/projects/palette.md',
            'knowledge/roadmap.md',
        ])
    })
    it('titles a note by its file name without the extension', () => {
        expect(brainNotes(tree).map((n) => n.title)).toEqual(['Ideas', 'palette', 'roadmap'])
    })
    it('tolerates a node without stats', () => {
        expect(brainNotes([{ path: 'knowledge/a.md', name: 'a.md', kind: 'file' }])[0]?.modifiedAt).toBe('1970-01-01T00:00:00.000Z')
    })
})
