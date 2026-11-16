import { useEffect, useRef, useState } from 'react'
import { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function readBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(new Error('Could not read this file. Please choose it again.'))
        reader.readAsDataURL(file)
    })
}
function date(ts?: string) {
    if (!ts) return '—'
    const value = new Date(Number(ts) * 1000)
    return Number.isNaN(value.getTime()) ? '—' : value.toISOString().slice(0, 10)
}

// 2026-11-16: one ephemeral preview in creation and settings; no import writes yet.
export function SlackImportPreviewPanel({ orgId }: { orgId: string }) {
    const [preview, setPreview] = useState<spaces.SlackImportPreview | null>(null)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [filename, setFilename] = useState('')
    const [query, setQuery] = useState('')
    const [page, setPage] = useState(0)
    const generation = useRef(0)
    useEffect(() => () => { generation.current++ }, [orgId])
    const upload = async (file?: File) => {
        const request = ++generation.current
        setPreview(null); setSelected(new Set()); setError(''); setPage(0); setQuery(''); setFilename(file?.name ?? '')
        if (!file) return
        if (!file.size || file.size > spaces.MAX_SLACK_ZIP_BYTES) {
            setError('Choose a non-empty Slack export ZIP up to 25 MiB.'); return
        }
        setBusy(true)
        try {
            const bytes = await readBase64(file)
            if (request !== generation.current) return
            const result = await window.ipc.invoke('spaces:previewSlackImport', { orgId, bytes })
            if (request !== generation.current) return
            setPreview(result)
        } catch (err) {
            if (request === generation.current) setError(err instanceof Error ? err.message : 'Could not preview this export.')
        } finally {
            if (request === generation.current) setBusy(false)
        }
    }
    const channels = preview?.channels.filter(c => c.name.toLowerCase().includes(query.toLowerCase())) ?? []
    const chosen = preview?.channels.filter(c => selected.has(c.id)) ?? []
    const toggle = (id: string) => setSelected(current => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
    })
    return <section className="space-y-4 py-4">
        <div><h2 className="text-base font-medium">Import from Slack</h2>
            <p className="mt-1 text-sm text-muted-foreground">Upload a Slack JSON export ZIP to review its channels. Each selected channel will become a separate new space.</p></div>
        <p className="rounded-lg bg-muted p-3 text-sm">Preview only: importing history is not available yet. Your archive and channel selection are not saved when you leave this screen.</p>
        <label className="block text-sm">Slack export ZIP (up to 25 MiB)
            <Input type="file" accept=".zip,application/zip" disabled={busy} className="mt-2" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void upload(file) }} />
        </label>
        {busy && <p role="status" className="text-sm">Uploading and checking {filename}…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {preview && <>
            <p role="status" className="text-sm">{filename}: {preview.channels.length} channels found. {preview.records.accepted} message records accepted, {preview.records.skipped} skipped, {preview.records.superseded} superseded.</p>
            <p className="text-xs text-muted-foreground">Counts include retained deletion records. File links are preserved; files are not downloaded. DMs and canvases are not supported.</p>
            {preview.channels.length === 0 ? <p>No supported channels were found in this export.</p> : <>
                <Input aria-label="Search Slack channels" placeholder="Search channels…" value={query} onChange={e => {setQuery(e.target.value);setPage(0)}} />
                <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setSelected(new Set(channels.map(c => c.id)))}>Select matching channels</Button><Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear selection</Button></div>
                <div className="max-h-80 overflow-auto rounded-lg border border-border"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border"><th className="p-3">Channel</th><th className="p-3">Messages / replies</th><th className="p-3">Dates (UTC)</th></tr></thead><tbody>
                    {channels.slice(page * 50, (page + 1) * 50).map(c => <tr key={c.id} className="border-b border-border last:border-0"><td className="p-3"><label className="flex items-start gap-2"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.name}`} /><span className="break-all">#{c.name}<span className="block text-muted-foreground">{c.private ? 'Private' : 'Public'}{c.archived ? ' · Archived' : ''}</span></span></label></td><td className="p-3">{c.messages} / {c.replies}</td><td className="p-3">{date(c.firstTimestamp)} – {date(c.lastTimestamp)}</td></tr>)}
                </tbody></table>{channels.length === 0 && <p className="p-3 text-sm">No matching channels.</p>}</div>
                {channels.length > 50 && <div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-xs">Page {page + 1} of {Math.ceil(channels.length / 50)}</span><Button variant="outline" size="sm" disabled={(page + 1) * 50 >= channels.length} onClick={() => setPage(page + 1)}>Next</Button></div>}
                <p className="text-sm" aria-live="polite">{chosen.length} channels selected · {chosen.reduce((n, c) => n + c.messages, 0)} messages · {chosen.reduce((n, c) => n + c.replies, 0)} replies</p>
            </>}
            {preview.warnings.length > 0 && <details><summary className="cursor-pointer text-sm">{preview.warnings.length} warnings — review before importing</summary><ul className="mt-2 max-h-48 space-y-2 overflow-auto text-xs">{preview.warnings.slice(0, 100).map((w, i) => <li key={i} className="break-words"><strong>{w.code}</strong>: {w.path}{w.record !== undefined ? ` (record ${w.record})` : ''} — {w.detail}</li>)}</ul>{preview.warnings.length > 100 && <p className="text-xs">Showing the first 100 warnings.</p>}</details>}
        </>}
    </section>
}
