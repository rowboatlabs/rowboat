import type { spaces } from '@x/shared'

// What the Connections panel computes without asking Harbor (spec §8 Space
// connections, 2026-11-28): the form a trigger's setup needs, drawn from the
// JSON Schema the app publishes, and the words of a refusal. Kept apart from
// the panel so the rules are tested without rendering it.

/** How one setting is drawn. `text` is every type the form has no input for: an array, an object, or none given. */
export type ConfigFieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'text'

export interface ConfigField {
    key: string
    /** The schema's `title`, or the key itself: Harbor's refusals name the key, so an untitled field reads the same in both. */
    label: string
    description?: string
    required: boolean
    kind: ConfigFieldKind
    /** An enum's choices as the schema lists them, sent back unchanged (a choice is not always a string). */
    options?: readonly unknown[]
    default?: unknown
}

/** A form's state: text for every input, a boolean for a checkbox, an enum as the index of its choice. */
export type ConfigValues = Record<string, string | boolean>

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The settings a trigger's `config` schema asks for, in the schema's order. `{}` or no properties = none. */
export function configFields(schema: Record<string, unknown>): ConfigField[] {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter((k): k is string => typeof k === 'string') : [])
    // A field the schema requires without describing still has to be filled, so it gets a plain input.
    const keys = [...Object.keys(properties), ...[...required].filter((k) => !(k in properties))]
    return keys.map((key) => {
        const prop = isRecord(properties[key]) ? properties[key] : {}
        // `["string", "null"]` is a string that may be left out.
        const type = Array.isArray(prop.type) ? prop.type.find((t) => t !== 'null') : prop.type
        const options = Array.isArray(prop.enum) && prop.enum.length > 0 ? prop.enum : undefined
        const kind: ConfigFieldKind = options ? 'enum'
            : type === 'string' ? 'string'
            : type === 'number' || type === 'integer' ? 'number'
            : type === 'boolean' ? 'boolean'
            : 'text'
        return {
            key,
            label: typeof prop.title === 'string' && prop.title.trim() ? prop.title.trim() : key,
            ...(typeof prop.description === 'string' && prop.description.trim() ? { description: prop.description.trim() } : {}),
            required: required.has(key),
            kind,
            ...(options ? { options } : {}),
            ...(prop.default !== undefined ? { default: prop.default } : {}),
        }
    })
}

function same(a: unknown, b: unknown): boolean {
    return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Where a form starts. A trigger being added starts from the schema's
 * defaults. One already saved starts from exactly what it holds and takes no
 * defaults: Harbor tells triggers apart by their config, so a default slipped
 * into an untouched one would have it removed and made again on Save.
 */
export function initialValues(fields: readonly ConfigField[], config?: Record<string, unknown>): ConfigValues {
    const values: ConfigValues = {}
    for (const field of fields) {
        const value = config ? config[field.key] : field.default
        if (field.kind === 'boolean') values[field.key] = value === true
        else if (field.kind === 'enum') {
            const index = value === undefined ? -1 : (field.options ?? []).findIndex((option) => same(option, value))
            values[field.key] = index >= 0 ? String(index) : ''
        } else if (value === undefined || value === null) values[field.key] = ''
        else values[field.key] = typeof value === 'string' ? value : JSON.stringify(value)
    }
    return values
}

/** What stops a form from being saved, by field: a required one left empty, a number that is not one. */
export function configProblems(fields: readonly ConfigField[], values: ConfigValues): Record<string, string> {
    const problems: Record<string, string> = {}
    for (const field of fields) {
        const value = values[field.key]
        if (typeof value !== 'string') continue
        const text = value.trim()
        if (field.required && !text) problems[field.key] = `${field.label} is required`
        else if (field.kind === 'number' && text && !Number.isFinite(Number(text))) problems[field.key] = `${field.label} must be a number`
    }
    return problems
}

/**
 * The config a form sends. A setting left empty is left out, so the app's own
 * default applies. `saved` is the config the trigger already holds: keys the
 * schema no longer describes ride along untouched, and a checkbox it had
 * stored stays stored, so an untouched trigger sends back what it holds.
 */
export function configFromValues(fields: readonly ConfigField[], values: ConfigValues, saved: Record<string, unknown> = {}): Record<string, unknown> {
    const described = new Set(fields.map((f) => f.key))
    const config: Record<string, unknown> = Object.fromEntries(Object.entries(saved).filter(([key]) => !described.has(key)))
    for (const field of fields) {
        const value = values[field.key]
        if (field.kind === 'boolean') {
            // Unticked says "no" only where that differs from saying nothing: a required field, one with a default, one already stored.
            if (value === true || field.required || field.default !== undefined || field.key in saved) config[field.key] = value === true
            continue
        }
        const text = typeof value === 'string' ? value.trim() : ''
        if (!text) continue
        if (field.kind === 'enum') {
            const option = field.options?.[Number(text)]
            if (option !== undefined) config[field.key] = option
        } else if (field.kind === 'number') config[field.key] = Number(text)
        else if (field.kind === 'text') config[field.key] = structured(text)
        else config[field.key] = text
    }
    return config
}

/** A plain field holds a list or an object as JSON, since there is no input for one; anything else is the text as typed. */
function structured(text: string): unknown {
    try {
        const parsed: unknown = JSON.parse(text)
        return typeof parsed === 'object' && parsed !== null ? parsed : text
    } catch {
        return text
    }
}

/**
 * What Harbor said when it refused, as it said it ("Issue created needs
 * team_id"). The desktop's IPC wraps a handler's error in its own sentence;
 * the web app's does not, so the wrapper is taken off here.
 */
export function refusalText(error: unknown, fallback: string): string {
    if (!(error instanceof Error) || !error.message) return fallback
    return error.message.replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, '') || fallback
}

/** A connection's state in a word, for its row. Paused is the admin's doing, so it only shows on one that would otherwise post. */
export function connectionStatusLabel(connection: Pick<spaces.SpaceConnection, 'status' | 'paused'>): string {
    if (connection.status === 'pending') return 'Waiting for authorisation'
    if (connection.status === 'failed') return 'Needs reconnecting'
    return connection.paused ? 'Paused' : 'Active'
}

/** Only an https logo is drawn: the address comes from the app catalogue, and the web app's policy loads images from https alone. */
export function connectionLogo(app: { logo?: string | undefined } | undefined): string | undefined {
    return app?.logo?.startsWith('https://') ? app.logo : undefined
}
