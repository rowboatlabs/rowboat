import { beforeEach, describe, expect, it, vi } from 'vitest'

const load = async () => {
    vi.resetModules()
    return import('./spaces-thread-draft')
}

beforeEach(() => window.localStorage.clear())

describe('stageThreadDraft', () => {
    it('writes the composer slot, keeps a record, and tells subscribers', async () => {
        const m = await load()
        const seen: unknown[] = []
        const off = m.subscribeStagedThreadDraft((staged) => seen.push(staged.text))
        const staged = m.stageThreadDraft('o1', 's1', 'r1', 'after lunch')
        off()
        expect(m.threadDraftKey('o1', 's1', 'r1')).toBe('o1/s1/r1')
        expect(window.localStorage.getItem(m.draftStorageKey('o1/s1/r1'))).toBe('after lunch')
        expect(staged).toMatchObject({ draftKey: 'o1/s1/r1', text: 'after lunch', before: '', rejected: [] })
        expect(m.getStagedThreadDraft('o1/s1/r1')).toEqual(staged)
        expect(seen).toEqual(['after lunch'])
    })

    it('joins an unsent draft and remembers it as before', async () => {
        const m = await load()
        window.localStorage.setItem(m.draftStorageKey('o1/s1/r1'), 'I think')
        m.stageThreadDraft('o1', 's1', 'r1', 'after lunch', { rejected: ['r9'] })
        expect(window.localStorage.getItem(m.draftStorageKey('o1/s1/r1'))).toBe('I think after lunch')
        expect(m.getStagedThreadDraft('o1/s1/r1')).toMatchObject({ before: 'I think', rejected: ['r9'] })
    })

    it('survives a reload through storage', async () => {
        const first = await load()
        first.stageThreadDraft('o1', 's1', 'r1', 'x', { rejected: ['r2'] })
        const second = await load()
        expect(second.getStagedThreadDraft('o1/s1/r1')).toMatchObject({ text: 'x', rejected: ['r2'] })
    })
})

describe('taking the reply back', () => {
    it('peeks at the reply as edited, without the earlier draft', async () => {
        const m = await load()
        window.localStorage.setItem(m.draftStorageKey('o1/s1/r1'), 'I think')
        m.stageThreadDraft('o1', 's1', 'r1', 'after lunch')
        // The person edited it in the thread composer.
        window.localStorage.setItem(m.draftStorageKey('o1/s1/r1'), 'I think after lunch, honestly')
        expect(m.peekStagedReply('o1/s1/r1')).toBe('after lunch, honestly')
    })

    it('release restores the earlier draft and drops the record', async () => {
        const m = await load()
        window.localStorage.setItem(m.draftStorageKey('o1/s1/r1'), 'I think')
        m.stageThreadDraft('o1', 's1', 'r1', 'after lunch', { rejected: ['r0'] })
        expect(m.releaseStagedThreadDraft('o1/s1/r1')).toEqual({ text: 'after lunch', before: 'I think', rejected: ['r0'] })
        expect(window.localStorage.getItem(m.draftStorageKey('o1/s1/r1'))).toBe('I think')
        expect(m.getStagedThreadDraft('o1/s1/r1')).toBeNull()
        expect(m.releaseStagedThreadDraft('o1/s1/r1')).toBeNull()
    })

    it('clear keeps the draft as the person’s own', async () => {
        const m = await load()
        m.stageThreadDraft('o1', 's1', 'r1', 'after lunch')
        m.clearStagedThreadDraft('o1/s1/r1')
        expect(m.getStagedThreadDraft('o1/s1/r1')).toBeNull()
        expect(window.localStorage.getItem(m.draftStorageKey('o1/s1/r1'))).toBe('after lunch')
        expect(m.peekStagedReply('o1/s1/r1')).toBe('')
    })
})

describe('composer picks (2026-11-07)', () => {
    it('hands a thread its picked models back on a fresh read, per thread', async () => {
        const m = await load()
        m.writeComposerPicks('o1/s1/r1', { model: { provider: 'p', model: 'm', effort: 'high' }, members: { local: { model: 'opus' } } })
        expect(m.readComposerPicks('o1/s1/r1')).toEqual({ model: { provider: 'p', model: 'm', effort: 'high' }, members: { local: { model: 'opus' } } })
        expect(m.readComposerPicks('o1/s1/r2')).toEqual({})
    })

    it('drops the slot once nothing is picked', async () => {
        const m = await load()
        m.writeComposerPicks('o1/s1/r1', { members: { local: { model: 'opus' } } })
        m.writeComposerPicks('o1/s1/r1', { members: {} })
        expect(window.localStorage.length).toBe(0)
    })

    it('ignores a slot it cannot read', async () => {
        const m = await load()
        window.localStorage.setItem('spaces:picks:o1/s1/r1', '{not json')
        expect(m.readComposerPicks('o1/s1/r1')).toEqual({})
        window.localStorage.setItem('spaces:picks:o1/s1/r1', JSON.stringify({ model: { provider: 1 }, members: ['x'] }))
        expect(m.readComposerPicks('o1/s1/r1')).toEqual({})
    })
})
