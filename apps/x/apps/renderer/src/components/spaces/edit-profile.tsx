import { useEffect, useState } from 'react'
import type { spaces } from '@x/shared'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { applyProfileUpdate } from '@/hooks/use-space-members'
import { useProfileImage } from '@/hooks/use-profile-image'
import { initials } from '@/lib/spaces-presentation'

type Photo = { bytes: string; mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; preview: string }

export function EditProfile({ orgId, orgName, onClose }: { orgId: string; orgName?: string; onClose: () => void }) {
    const [member, setMember] = useState<spaces.Member>()
    const [name, setName] = useState('')
    const [title, setTitle] = useState('')
    const [photo, setPhoto] = useState<Photo | null | undefined>()
    const [saving, setSaving] = useState(false)
    const [reading, setReading] = useState(false)
    const [error, setError] = useState('')
    const [loadAttempt, setLoadAttempt] = useState(0)
    const avatar = useProfileImage(orgId, member?.avatarUrl)
    useEffect(() => {
        let cancelled = false
        void window.ipc.invoke('spaces:getProfile', { orgId }).then(({ member }) => {
            if (cancelled) return
            setMember(member)
            setName(member.displayName)
            setTitle(member.title ?? '')
        }, () => { if (!cancelled) setError('Could not load your profile. Please try again.') })
        return () => { cancelled = true }
    }, [orgId, loadAttempt])
    const pick = async (file?: File) => {
        if (!file) return
        setError('')
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { setError('Choose a PNG, JPEG, WebP, or GIF image.'); return }
        if (file.size > 1024 * 1024 || !file.size) { setError('Choose an image smaller than 1 MB.'); return }
        setReading(true)
        try {
            const bytes = new Uint8Array(await file.arrayBuffer())
            let binary = ''
            for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
            const encoded = btoa(binary)
            setPhoto({ bytes: encoded, mime: file.type as Photo['mime'], preview: `data:${file.type};base64,${encoded}` })
        } catch { setError('Could not read this image. Please try another file.') }
        finally { setReading(false) }
    }
    const save = async () => {
        setSaving(true)
        setError('')
        let savedFields = false
        try {
            const { member: updated } = await window.ipc.invoke('spaces:updateProfile', { orgId, displayName: name.replace(/\s+/g, ' ').trim(), title: title.replace(/\s+/g, ' ').trim() })
            applyProfileUpdate(orgId, updated)
            setMember(updated)
            savedFields = true
            if (photo !== undefined) {
                const result = photo === null
                    ? await window.ipc.invoke('spaces:clearAvatar', { orgId })
                    : await window.ipc.invoke('spaces:setAvatar', { orgId, bytes: photo.bytes, mime: photo.mime })
                applyProfileUpdate(orgId, result.member)
            }
            onClose()
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Please try again.'
            setError(savedFields ? `Your name and title were saved, but the photo could not be updated. ${message}` : `Could not save your profile. ${message}`)
        }
        finally { setSaving(false) }
    }
    const src = photo === null ? undefined : photo?.preview ?? avatar
    return <Dialog open onOpenChange={open => { if (!open && !saving && !reading) onClose() }}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Edit profile</DialogTitle><DialogDescription>Your profile in {orgName ?? 'this organization'}.</DialogDescription></DialogHeader>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {!member ? <div>{error ? <Button onClick={() => { setError(''); setLoadAttempt(n => n + 1) }}>Try again</Button> : <p role="status">Loading profile…</p>}</div> :
                <form className="space-y-5" onSubmit={e => { e.preventDefault(); if (name.trim() && !saving && !reading) void save() }}>
                    <fieldset disabled={saving || reading} className="space-y-5 disabled:opacity-60">
                        <div className="flex items-center gap-4">
                            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-2xl font-semibold">{src ? <img src={src} alt="Profile preview" className="size-full object-cover" /> : initials(name)}</div>
                            <div className="space-y-2">
                                <label className="block text-sm font-medium">Profile photo<Input aria-label="Profile photo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => { void pick(e.target.files?.[0]); e.target.value = '' }} /></label>
                                <p className="text-xs text-muted-foreground">PNG, JPEG, WebP, or GIF. Up to 1 MB.</p>
                                {(photo || (photo !== null && member.avatarUrl)) && <Button type="button" variant="ghost" size="sm" onClick={() => setPhoto(null)}>Remove photo</Button>}
                            </div>
                        </div>
                        <label className="block space-y-2 text-sm font-medium"><span>Display name</span><Input value={name} required maxLength={128} onChange={e => setName(e.target.value)} /></label>
                        <label className="block space-y-2 text-sm font-medium"><span>Job title</span><Input value={title} maxLength={128} placeholder="What do you do?" onChange={e => setTitle(e.target.value)} /></label>
                    </fieldset>
                    <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving || reading} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving || reading || !name.trim()}>{saving ? 'Saving…' : 'Save changes'}</Button></div>
                </form>}
        </DialogContent>
    </Dialog>
}
