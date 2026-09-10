import { describe, expect, it } from 'vitest'
import { resolveProjectsLocation } from './projects-navigation'

const alpha = { id: 'alpha', name: 'Alpha', path: 'knowledge/Workspace/Alpha', chats: [{ id: 'chat-1', title: 'Report', modifiedAt: '2026-09-10' }] }
const beta = { id: 'beta', name: 'Beta', path: 'knowledge/Workspace/Beta', chats: [] }

const general = { id: 'default', name: 'General', path: 'knowledge/Workspace', isDefault: true, chats: [] }

describe('returning to Assistant', () => {
    it('opens General on first entry even though it is last in the rail', () => {
        expect(resolveProjectsLocation([alpha, beta, general], null)).toEqual({ path: general.path })
    })
    it('restores a renamed project by chat before falling back to General', () => {
        const renamed = { ...alpha, path: 'knowledge/Workspace/Renamed' }
        expect(resolveProjectsLocation([renamed, general], { path: alpha.path, runId: 'chat-1' }))
            .toEqual({ path: renamed.path, runId: 'chat-1' })
    })
    it('falls back to General without retaining a removed project file', () => {
        expect(resolveProjectsLocation([general], { path: alpha.path, filePath: `${alpha.path}/report.md` }))
            .toEqual({ path: general.path })
    })
    it('opens a project on first entry rather than a pathless file rail', () => {
        expect(resolveProjectsLocation([alpha, beta], null)).toEqual({ path: alpha.path })
    })
    it('restores the same project, rich chat, and file on subsequent entries', () => {
        const previous = { path: alpha.path, runId: 'chat-1', filePath: `${alpha.path}/report.md` }
        expect(resolveProjectsLocation([beta, alpha], previous)).toEqual(previous)
    })
    it('does not resume a deleted chat', () => {
        expect(resolveProjectsLocation([alpha], { path: alpha.path, runId: 'deleted' })).toEqual({ path: alpha.path })
    })
    it('falls back to an available project if the last project was removed', () => {
        expect(resolveProjectsLocation([beta], { path: alpha.path, runId: 'chat-1' })).toEqual({ path: beta.path })
        expect(resolveProjectsLocation([], { path: alpha.path })).toBeNull()
    })
    it('recovers renamed project paths through the chat association', () => {
        const renamed = { ...alpha, name: 'Launch', path: 'knowledge/Workspace/Launch' }
        expect(resolveProjectsLocation([renamed], { path: alpha.path, runId: 'chat-1', filePath: `${alpha.path}/report.md` }))
            .toEqual({ path: renamed.path, runId: 'chat-1', filePath: `${renamed.path}/report.md` })
    })
    it('keeps nested file paths intact when restoring an old folder location', () => {
        expect(resolveProjectsLocation([alpha], { path: `${alpha.path}/reports`, filePath: `${alpha.path}/reports/draft.md` }))
            .toEqual({ path: alpha.path, filePath: `${alpha.path}/reports/draft.md` })
    })
})
