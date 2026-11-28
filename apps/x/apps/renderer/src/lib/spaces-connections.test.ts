import { describe, expect, it } from 'vitest'
import { configFields, configFromValues, configProblems, connectionLogo, connectionStatusLabel, initialValues, refusalText } from './spaces-connections'

// A trigger's setup form is drawn from the JSON Schema its app publishes
// (spec §8 Space connections, 2026-11-28): these pin what the form asks for,
// what blocks Save, and that a trigger nobody touched is sent back as it was.

const schema = {
    type: 'object',
    properties: {
        team_id: { type: 'string', title: 'Team', description: 'The team whose issues are posted' },
        state: { type: 'string', enum: ['open', 'closed'], default: 'open' },
        min_priority: { type: 'integer', title: 'Lowest priority' },
        include_drafts: { type: 'boolean', title: 'Include drafts' },
        labels: { type: 'array', items: { type: 'string' } },
        note: { type: ['string', 'null'] },
    },
    required: ['team_id', 'state'],
}

describe('configFields', () => {
    it('reads each property as the input it needs, in the schema’s order', () => {
        const fields = configFields(schema)
        expect(fields.map((f) => [f.key, f.kind, f.required])).toEqual([
            ['team_id', 'string', true],
            ['state', 'enum', true],
            ['min_priority', 'number', false],
            ['include_drafts', 'boolean', false],
            ['labels', 'text', false],
            ['note', 'string', false],
        ])
        expect(fields[0]).toMatchObject({ label: 'Team', description: 'The team whose issues are posted' })
        // No title: the key, which is what Harbor's refusal names.
        expect(fields[1]).toMatchObject({ label: 'state', options: ['open', 'closed'], default: 'open' })
    })

    it('asks for nothing when the trigger needs nothing, and still asks for a required field the schema does not describe', () => {
        expect(configFields({})).toEqual([])
        expect(configFields({ type: 'object', properties: {} })).toEqual([])
        expect(configFields({ required: ['repo'] })).toEqual([{ key: 'repo', label: 'repo', required: true, kind: 'text' }])
    })
})

describe('the form’s values', () => {
    const fields = configFields(schema)

    it('starts a new trigger from the schema’s defaults', () => {
        expect(initialValues(fields)).toEqual({ team_id: '', state: '0', min_priority: '', include_drafts: false, labels: '', note: '' })
    })

    it('starts a saved trigger from exactly what it holds, without defaults', () => {
        expect(initialValues(fields, { team_id: 'ENG', min_priority: 2, labels: ['bug'] })).toEqual({
            team_id: 'ENG', state: '', min_priority: '2', include_drafts: false, labels: '["bug"]', note: '',
        })
    })

    it('blocks a required field left empty and a number that is not one', () => {
        expect(configProblems(fields, initialValues(fields, {}))).toEqual({ team_id: 'Team is required', state: 'state is required' })
        expect(configProblems(fields, { ...initialValues(fields), team_id: '  ', min_priority: 'high' })).toEqual({
            team_id: 'Team is required', min_priority: 'Lowest priority must be a number',
        })
        expect(configProblems(fields, { ...initialValues(fields), team_id: 'ENG' })).toEqual({})
    })

    it('sends what was filled, typed as the schema says, and leaves out what was not', () => {
        const values = { team_id: ' ENG ', state: '1', min_priority: '2', include_drafts: true, labels: '["bug", "p0"]', note: '' }
        expect(configFromValues(fields, values)).toEqual({ team_id: 'ENG', state: 'closed', min_priority: 2, include_drafts: true, labels: ['bug', 'p0'] })
        // An unticked optional checkbox says nothing; a list typed plainly stays the text it is.
        expect(configFromValues(fields, { ...initialValues(fields), team_id: 'ENG', labels: 'bug' })).toEqual({ team_id: 'ENG', state: 'open', labels: 'bug' })
    })

    it('sends an untouched saved trigger back as it was, so Harbor keeps it', () => {
        const saved = { team_id: 'ENG', state: 'closed', min_priority: 2, include_drafts: false, labels: ['bug'], legacy: 'kept' }
        expect(configFromValues(fields, initialValues(fields, saved), saved)).toEqual(saved)
        const bare = { team_id: 'ENG', state: 'open' }
        expect(configFromValues(fields, initialValues(fields, bare), bare)).toEqual(bare)
    })

    it('keeps an enum’s choice as the schema lists it, not as text', () => {
        const numbered = configFields({ properties: { interval: { enum: [5, 15, 60] } }, required: ['interval'] })
        expect(configFromValues(numbered, { interval: '1' })).toEqual({ interval: 15 })
        expect(initialValues(numbered, { interval: 60 })).toEqual({ interval: '2' })
    })
})

describe('what a row says', () => {
    it('shows Harbor’s refusal as it was worded, without the desktop’s IPC wrapper', () => {
        expect(refusalText(new Error('Issue created needs team_id'), 'Could not save')).toBe('Issue created needs team_id')
        expect(refusalText(new Error("Error invoking remote method 'spaces:updateSpaceConnection': SpacesRequestError: Issue created needs team_id"), 'Could not save'))
            .toBe('Issue created needs team_id')
        expect(refusalText('nope', 'Could not save')).toBe('Could not save')
    })

    it('names a connection’s state, and draws only an https logo', () => {
        expect(connectionStatusLabel({ status: 'pending', paused: false })).toBe('Waiting for authorisation')
        expect(connectionStatusLabel({ status: 'active', paused: false })).toBe('Active')
        expect(connectionStatusLabel({ status: 'active', paused: true })).toBe('Paused')
        expect(connectionStatusLabel({ status: 'failed', paused: true })).toBe('Needs reconnecting')
        expect(connectionLogo({ logo: 'https://logos.test/linear.svg' })).toBe('https://logos.test/linear.svg')
        expect(connectionLogo({ logo: 'http://logos.test/linear.svg' })).toBeUndefined()
        expect(connectionLogo(undefined)).toBeUndefined()
    })
})
