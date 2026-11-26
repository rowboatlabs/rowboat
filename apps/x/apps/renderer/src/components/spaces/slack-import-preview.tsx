import { FileArchive, Loader2 } from 'lucide-react'
import { SlackImportGuide } from './slack-import-guide'
import { SlackIcon } from '@/components/onboarding/provider-icons'
import { useEffect, useRef, useState } from 'react'
import { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { refreshSpacesOrgs } from '@/hooks/use-spaces'

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

function ImportJob({ job, retry, onOpenSpace }: {
    job: spaces.SlackImportJob
    retry: (id: string) => void
    onOpenSpace?: (id: string) => void
}) {
    const { status, count, detail, percent } = spaces.slackImportProgress(job)
    const active = job.status === 'queued' || job.status === 'running'
    return <article className="min-w-0 space-y-2 rounded-lg border border-border p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h3 className="flex items-center gap-2 font-medium">{active && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />}{status}</h3>
            <span className="break-all text-xs text-muted-foreground">{job.workspace}</span>
        </div>
        <Progress value={percent} aria-label={`Import progress for ${job.workspace}`} aria-valuetext={[count, detail].filter(Boolean).join('. ')} className="h-1.5" />
        <p role="status" className="text-[13px] leading-[18px] tabular-nums text-muted-foreground">{count}{detail && <span className="block break-words">{detail}</span>}</p>
        {job.error && <p role="alert" className="text-destructive">{job.error}</p>}
        {job.status === 'failed' && <Button variant="outline" size="sm" onClick={() => retry(job.id)}>Retry remaining channels</Button>}
        <details><summary className="cursor-pointer py-1">Channel details</summary>
            <ul className="max-h-56 divide-y divide-border overflow-y-auto">{job.channels.map(c => <li key={c.id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 break-all">#{c.name}</span><span className="text-xs capitalize text-muted-foreground">{c.status}</span>
                {c.status !== 'pending' && onOpenSpace && <Button variant="link" size="sm" aria-label={`Open space for #${c.name}`} onClick={() => onOpenSpace(c.spaceId)}>Open space</Button>}
            </li>)}</ul>
        </details>
        {job.warnings?.length > 0 && <details><summary className="cursor-pointer">{job.warnings.length} import warnings</summary><ul className="max-h-48 overflow-auto text-xs">{job.warnings.slice(0, 100).map((w, i) => <li key={i}>{w.path}: {w.detail}</li>)}</ul>{job.warnings.length > 100 && <p>Showing the first 100 warnings.</p>}</details>}
    </article>
}

// 2026-11-16: preview first, then explicit durable import; shared by creation and settings.
export function SlackImportPreviewPanel({ orgId, onOpenSpace }: { orgId: string; onOpenSpace?: (spaceId: string) => void }) {
    const [bytes, setBytes] = useState('')
    const [workspace, setWorkspace] = useState('')
    const [append, setAppend] = useState(false)
    const [jobs, setJobs] = useState<spaces.SlackImportJob[]>([])
    const [starting, setStarting] = useState(false)
    useEffect(() => {
        let disposed = false
        let timer: ReturnType<typeof setTimeout>
        let lastProgress = ''
        const poll = async () => {
            try {
                const result = await window.ipc.invoke('spaces:listSlackImports', { orgId })
                if (!disposed) {
                    setJobs(result.jobs)
                    const progress = result.jobs.map(j => `${j.id}:${j.status}:${j.channels.map(c => c.status).join('/')}`).join(',')
                    if (progress !== lastProgress && result.jobs.some(j => j.channels.some(c => c.status === 'imported'))) void refreshSpacesOrgs()
                    lastProgress = progress
                }
            } catch (err) { if (!disposed) setError(err instanceof Error ? err.message : 'Could not load import jobs.') }
            finally { if (!disposed) timer = setTimeout(poll, 2000) }
        }
        void poll()
        return () => { disposed = true; clearTimeout(timer) }
    }, [orgId])
    const start = async () => {
        setStarting(true); setError('')
        try {
            const job = await window.ipc.invoke('spaces:startSlackImport', { orgId, bytes, workspace: workspace.trim().toLowerCase(), channelIds: [...selected], existingChannels: append ? 'append' : 'skip' })
            setJobs(current => [job, ...current.filter(j => j.id !== job.id)])
            setBytes(''); setPreview(null); setSelected(new Set())
        } catch (err) { setError(err instanceof Error ? err.message : 'Could not start import.') }
        finally { setStarting(false) }
    }
    const retry = async (jobId: string) => {
        try { const job = await window.ipc.invoke('spaces:retrySlackImport', { orgId, jobId }); setJobs(current => [job, ...current.filter(j => j.id !== job.id)]) }
        catch (err) { setError(err instanceof Error ? err.message : 'Could not retry import.') }
    }
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
        setBytes(''); setPreview(null); setSelected(new Set()); setError(''); setPage(0); setQuery(''); setFilename(file?.name ?? '')
        if (!file) return
        if (!file.size || file.size > spaces.MAX_SLACK_ZIP_BYTES) {
            setError('Choose a non-empty Slack export ZIP up to 100 MiB.'); return
        }
        setBusy(true)
        try {
            const bytes = await readBase64(file)
            if (request !== generation.current) return
            const result = await window.ipc.invoke('spaces:previewSlackImport', { orgId, bytes })
            if (request !== generation.current) return
            setPreview(result); setBytes(bytes)
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
    return <section className="space-y-5 py-4">
        <div className="flex items-start gap-3">
            <div className="rounded-xl border border-border bg-background p-3"><SlackIcon className="size-6 shrink-0" /></div>
            <div><h2 className="text-lg font-semibold">Bring your Slack history</h2>
                <p className="mt-1 text-sm text-muted-foreground">Choose the conversations to bring with you. Each channel gets its own Rowboat space.</p></div>
        </div>
        <ol aria-label="Import steps" className="grid grid-cols-3 gap-2 text-xs">
            {['Upload ZIP', 'Choose channels', 'Import history'].map((step, index) => <li key={step} aria-current={(starting || jobs.some(job => job.status === 'queued' || job.status === 'running') ? 2 : preview ? 1 : 0) === index ? 'step' : undefined} className="flex items-center gap-2 rounded-lg bg-muted/40 p-2 text-muted-foreground aria-[current=step]:bg-muted aria-[current=step]:text-foreground"><span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-current">{index + 1}</span>{step}</li>)}
        </ol>
        {jobs[0] && <ImportJob job={jobs[0]} retry={retry} onOpenSpace={onOpenSpace} />}
        <SlackImportGuide />
        <div className="rounded-xl border border-dashed border-border bg-muted/10 p-4">
            <label className="block text-sm font-medium"><span className="flex items-center gap-2"><FileArchive className="size-4" aria-hidden />Slack export ZIP (up to 100 MiB)</span>
                <Input type="file" accept=".zip,application/zip" disabled={busy || starting} className="mt-3 h-auto cursor-pointer bg-background file:mr-3 file:cursor-pointer file:font-medium" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void upload(file) }} />
            </label>
            <p className="mt-2 text-xs text-muted-foreground">Use the original JSON export ZIP. We’ll show a preview before creating any spaces.</p>
            {busy && <p role="status" className="mt-3 flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" aria-hidden />Uploading and checking {filename}…</p>}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">Only you are added to new spaces. Invite teammates separately. Attachment links are kept; files are not downloaded. DMs and canvases are skipped.</p>
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        {preview && <>
            <h3 className="text-sm font-semibold">Review your export</h3>
            <p role="status" className="rounded-lg bg-muted/40 p-3 text-sm break-words">{filename}: {preview.channels.length} channels found. {preview.records.accepted} messages or deletion markers ready, {preview.records.skipped} unsupported records skipped, {preview.records.superseded} older versions replaced.</p>
            <p className="text-xs text-muted-foreground">Counts include retained deletion records. File links are preserved; files are not downloaded. DMs and canvases are not supported.</p>
            {preview.channels.length === 0 ? <p>No supported channels were found in this export.</p> : <>
                <Input aria-label="Search Slack channels" placeholder="Search channels…" value={query} onChange={e => {setQuery(e.target.value);setPage(0)}} />
                <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setSelected(new Set(channels.map(c => c.id)))}>Select matching channels</Button><Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear selection</Button></div>
                <div className="max-h-80 overflow-auto rounded-lg border border-border"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-background"><tr className="border-b border-border"><th className="p-3">Channel</th><th className="p-3">Messages / replies</th><th className="p-3">Dates (UTC)</th></tr></thead><tbody>
                    {channels.slice(page * 50, (page + 1) * 50).map(c => <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30"><td className="p-3"><label className="flex items-start gap-2"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.name}`} /><span className="break-all">#{c.name}<span className="block text-muted-foreground">{c.private ? 'Private' : 'Public'}{c.archived ? ' · Archived' : ''}</span></span></label></td><td className="p-3">{c.messages} / {c.replies}</td><td className="p-3">{date(c.firstTimestamp)} – {date(c.lastTimestamp)}</td></tr>)}
                </tbody></table>{channels.length === 0 && <p className="p-3 text-sm">No matching channels.</p>}</div>
                {channels.length > 50 && <div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-xs">Page {page + 1} of {Math.ceil(channels.length / 50)}</span><Button variant="outline" size="sm" disabled={(page + 1) * 50 >= channels.length} onClick={() => setPage(page + 1)}>Next</Button></div>}
                <p className="text-sm" aria-live="polite">{chosen.length} channels selected · {chosen.reduce((n, c) => n + c.messages, 0)} messages · {chosen.reduce((n, c) => n + c.replies, 0)} replies</p>
            </>}
            {chosen.length > 0 && <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                <h3 className="text-sm font-semibold">Ready to import</h3>
                <label className="block text-sm">Slack workspace domain<Input value={workspace} onChange={e => setWorkspace(e.target.value)} placeholder="team.slack.com" /></label>
                <p className="text-xs text-muted-foreground">For example, team.slack.com — use the same domain each time so we can recognize previous imports. Choose up to 100 channels.</p>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={append} onChange={e => setAppend(e.target.checked)} />Append new messages to channels I previously imported</label>
                {chosen.length > 100 && <p role="alert" className="text-sm text-destructive">Select 100 channels or fewer to start this import.</p>}
                {jobs.some(j => j.status === 'queued' || j.status === 'running') && <p role="status" className="text-sm text-muted-foreground">Another import is still running. You can start this one when it finishes.</p>}
                {append && <p className="text-xs text-muted-foreground">Requires admin access to each destination. Existing messages, edits and deletions stay unchanged; only unseen Slack timestamps are added.</p>}
                <Button disabled={starting || chosen.length > 100 || !workspace.trim() || jobs.some(j => j.status === 'queued' || j.status === 'running')} onClick={() => void start()}>{starting ? 'Starting import…' : append ? `Import or update ${chosen.length} channels` : `Import ${chosen.length} channels as new spaces`}</Button>
            </div>}
            {preview.warnings.length > 0 && <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm">{preview.warnings.length} warnings — review before importing</summary><ul className="mt-2 max-h-48 space-y-2 overflow-auto text-xs">{preview.warnings.slice(0, 100).map((w, i) => <li key={i} className="break-words"><strong>{w.code}</strong>: {w.path}{w.record !== undefined ? ` (record ${w.record})` : ''} — {w.detail}</li>)}</ul>{preview.warnings.length > 100 && <p className="text-xs">Showing the first 100 warnings.</p>}</details>}
        </>}
        {jobs.length > 1 && <details><summary className="cursor-pointer text-sm">Previous imports ({jobs.length - 1})</summary>
            <div className="mt-2 space-y-2">{jobs.slice(1).map(job => <ImportJob key={job.id} job={job} retry={retry} onOpenSpace={onOpenSpace} />)}</div>
        </details>}
    </section>
}
