import { useState } from 'react'
import { useSpacesOrgs } from '@/hooks/use-spaces'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { EditProfile } from './edit-profile'

export function ProfileSettings({ onClose }: { onClose: () => void }) {
    const { orgs } = useSpacesOrgs()
    const [selected, setSelected] = useState<string>()
    const org = orgs.find(o => o.id === selected) ?? (orgs.length === 1 ? orgs[0] : undefined)
    if (org) return <EditProfile key={org.id} orgId={org.id} orgName={org.name} onClose={onClose} />
    return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
        <DialogContent><DialogHeader><DialogTitle>Edit profile</DialogTitle><DialogDescription>Choose the organization whose profile you want to edit.</DialogDescription></DialogHeader>
            {orgs.map(org => <Button key={org.id} variant="outline" className="justify-start" onClick={() => setSelected(org.id)}>{org.name}</Button>)}
            {!orgs.length && <p className="text-sm text-muted-foreground">Join an organization to create your Spaces profile.</p>}
        </DialogContent>
    </Dialog>
}
