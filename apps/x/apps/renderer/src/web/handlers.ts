import { harborChannelHandlers, parseInviteLink, SpacesClient, SpaceSubscriptions } from '@x/spaces-client'
import { blobAppUrl } from '@/lib/spaces-presentation'
import type { ipc, spaces } from '@x/shared'
import { beginSignIn, getAccessToken, hasSession } from './account'
import { APEX_HOST, APEX_URL, DEV_HARBOR } from './config'
import { inviteOpenPath, rememberJoinClick } from './links'
import * as orgs from './orgs'
import { harborSession } from './session'

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

/**
 * An invite to an org on this deployment (or the dev Harbor): the only orgs
 * the web app can reach, since its page connects nowhere else (CSP) and only
 * they take its session. A self-hosted org's invite opens in the desktop app.
 */
function deploymentInvite(url: string): { baseUrl: string; token: string } {
    const parsed = parseInviteLink(url)
    if (!parsed) throw new Error('That isn’t an invite link. It looks like https://<server>/join/<code>.')
    const host = new URL(parsed.baseUrl).host
    const ours = DEV_HARBOR ? parsed.baseUrl === new URL(DEV_HARBOR).origin : host.endsWith(`.${APEX_HOST}`)
    if (!ours) throw new Error(`This invite is for ${host}, which opens in the Rowboat desktop app.`)
    return parsed
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

        // Invites (2026-10-13): read pre-auth, accepted on the session cookie,
        // which every org on the deployment takes. Joining signed out signs in
        // first and comes back to the same invite (links.ts).
        'spaces:resolveInviteLink': async (args) => {
            const { baseUrl, token } = deploymentInvite(args.url)
            return { baseUrl, resolved: await new SpacesClient({ baseUrl, token: '' }).resolveInvite(token) }
        },
        'spaces:joinInvite': async (args) => {
            const { baseUrl, token } = deploymentInvite(args.url)
            if (!DEV_HARBOR && !hasSession()) {
                rememberJoinClick(args.url)
                return beginSignIn(inviteOpenPath(new URL(baseUrl).host, token))
            }
            const { space } = await new SpacesClient({ baseUrl, token: harborSession }).acceptInvite(token)
            const org = (await orgs.loadOrgs()).find((o) => o.baseUrl === baseUrl)
            if (!org) throw new Error(`You joined ${space?.name ?? 'the server'}, but it isn’t listed yet. Reload to see it.`)
            return { org, ...(space ? { space } : {}) }
        },

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
