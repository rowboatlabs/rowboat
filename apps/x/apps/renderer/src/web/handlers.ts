import { harborChannelHandlers, SpaceSubscriptions } from '@x/spaces-client'
import { blobAppUrl } from '@/lib/spaces-presentation'
import type { ipc, spaces } from '@x/shared'
import { beginSignIn, getAccessToken, hasSession } from './account'
import { APEX_HOST, APEX_URL, DEV_HARBOR } from './config'
import * as orgs from './orgs'

// The Spaces channels, served in the tab: the shared table for everything
// that is one Harbor call, and the few the browser answers its own way. What
// needs the desktop's core (the local agent, scheduled sends, uploads by
// file path, link previews fetched off-page) is left out, and the host
// refuses it by name.

type IPCChannels = ipc.IPCChannels
type Handlers = { [K in keyof IPCChannels]?: (args: IPCChannels[K]['req']) => Promise<IPCChannels[K]['res']> }

function decodeBase64(base64: string): Uint8Array {
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
}

/** Save through the browser's own download: a link the browser follows. */
function download(href: string, name?: string): void {
    const a = document.createElement('a')
    a.href = href
    if (name) a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
}

/**
 * A blob's own Harbor URL, served as an attachment under its name. The
 * session cookie authorizes the download (CONTRACT.md: getBlob's download=1).
 */
function blobDownloadUrl(orgId: string, spaceId: string, hash: string, name: string): string {
    const url = new URL(blobAppUrl({ orgId, spaceId }, hash))
    url.search = ''
    url.searchParams.set('name', name)
    url.searchParams.set('download', '1')
    return url.toString()
}

export function webChannelHandlers(emit: (event: spaces.SpacesBusEvent) => void): Handlers {
    const subscriptions = new SpaceSubscriptions({ getLive: orgs.getLive, onRuntimeReset: orgs.onRuntimeReset })
    orgs.onMemberFrame((orgId, frame) => emit({ orgId, frame }))
    const here = () => `${window.location.pathname}${window.location.search}`

    return {
        ...harborChannelHandlers({ getClient: orgs.getClient, getLive: orgs.getLive, subscriptions, emit }),

        'spaces:listOrgs': async () => ({ orgs: await orgs.loadOrgs() }),
        'spaces:accountState': async () => ({ hasSession: hasSession(), appSignedIn: hasSession() }),
        'spaces:signInRowboat': async () => beginSignIn(here()),
        'spaces:signInOrg': async () => beginSignIn(here()),
        'spaces:apexInfo': async () => ({ apexDomain: DEV_HARBOR ? null : APEX_HOST }),

        'spaces:createOrg': async (args) => {
            const res = await fetch(`${APEX_URL}/v1/orgs`, {
                method: 'POST',
                headers: { authorization: `Bearer ${await getAccessToken()}`, 'content-type': 'application/json' },
                body: JSON.stringify({ name: args.name }),
            })
            const json = (await res.json().catch(() => ({}))) as { org?: { id: string }; message?: string }
            if (!res.ok || !json.org) throw new Error(json.message ?? `Could not create the server (${res.status}).`)
            const created = (await orgs.loadOrgs()).find((org) => org.id === json.org!.id)
            if (!created) throw new Error('The server was created but is not listed yet. Reload to see it.')
            return { org: created }
        },

        // A browser has the bytes, never a path (electronUtils.getPathForFile is '').
        'spaces:uploadBlob': async (args) => {
            if (args.bytes === undefined) throw new Error('Upload the file itself; the browser has no file paths.')
            const blob = await orgs.getClient(args.orgId).uploadBlob(args.spaceId, decodeBase64(args.bytes), {
                ...(args.mime ? { declaredMime: args.mime } : {}),
            })
            return { blob }
        },

        // The desktop's model account (the LLM gateway's sign-in); the browser has none.
        'account:getRowboat': async () => ({ signedIn: false, accessToken: null }),

        // Saving is the browser's download; there's no path to report back.
        'spaces:saveBlob': async (args) => {
            download(blobDownloadUrl(args.orgId, args.spaceId, args.hash, args.suggestedName ?? args.hash.slice(0, 12)))
            return { saved: true }
        },
        'spaces:saveAsset': async (args) => {
            const asset = await orgs.getClient(args.orgId).readAsset(args.spaceId, args.assetId)
            const name = asset.path.split('/').pop() || asset.path
            if (asset.blob) {
                download(blobDownloadUrl(args.orgId, args.spaceId, asset.blob.hash, name))
            } else {
                const href = URL.createObjectURL(new Blob([asset.content], { type: 'text/plain;charset=utf-8' }))
                download(href, name)
                setTimeout(() => URL.revokeObjectURL(href), 60_000)
            }
            return { saved: true }
        },
        // Another site's image can't be fetched from here (CORS), so it opens
        // where the person can save it. saved: false means no saved toast.
        'spaces:saveImageUrl': async (args) => {
            window.open(args.url, '_blank', 'noopener,noreferrer')
            return { saved: false }
        },

        'spaces:linkPreview': async () => ({ preview: null }),
        'spaces:listScheduled': async () => ({ items: [] }),

        'spaces:bounceLive': async () => {
            orgs.bounceAllLive()
            return { success: true }
        },
    }
}
