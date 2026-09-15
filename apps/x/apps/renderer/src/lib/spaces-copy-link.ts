import { toast } from '@/lib/toast'

/** Copy the canonical URL; sharing a link does not change its target's access. */
export async function copySpacesLink(url: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(url)
        toast('Link copied', 'success')
    } catch {
        toast('Could not copy link', 'error')
    }
}
