import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The web app's blob URLs (2026-10-12): the org's own Harbor blob route, which
// the session cookie authorizes, in place of the desktop's app://space-blob.
// LOCAL_RUNTIME is read as feature-flags loads, so the module loads fresh
// under the browser host's flags.

describe('blob URLs in the web app', () => {
    beforeEach(() => {
        vi.resetModules()
        window.featureFlags = { spaces: true, localRuntime: false }
    })
    afterEach(() => {
        delete window.featureFlags
        vi.resetModules()
    })

    const hash = 'a'.repeat(64)
    const SPACE = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

    it('are the org’s own Harbor URLs', async () => {
        const { blobAppUrl, isBlobAppUrl, registerOrgOrigin } = await import('./spaces-presentation')
        registerOrgOrigin('org-1', 'https://acme.spaces.test/')
        const url = blobAppUrl({ orgId: 'org-1', spaceId: SPACE }, hash, { thumb: 64 })
        expect(url).toBe(`https://acme.spaces.test/v1/spaces/${SPACE}/blobs/${hash}?thumb=64`)
        expect(isBlobAppUrl(url)).toBe(true)
        expect(isBlobAppUrl(`app://space-blob/org-1/${SPACE}/${hash}`)).toBe(false)
        expect(isBlobAppUrl(`https://elsewhere.test/v1/spaces/${SPACE}/blobs/${hash}`)).toBe(false)
    })

    it('parse back into their parts, the org found by its origin', async () => {
        const { blobAppUrl, parseBlobAppUrl, registerOrgOrigin } = await import('./spaces-presentation')
        registerOrgOrigin('org-1', 'https://acme.spaces.test')
        expect(parseBlobAppUrl(blobAppUrl({ orgId: 'org-1', spaceId: SPACE }, hash))).toEqual({ orgId: 'org-1', spaceId: SPACE, hash })
    })

    it('are what wire blob links in a body rewrite to', async () => {
        const { rewriteBlobLinks, registerOrgOrigin } = await import('./spaces-presentation')
        registerOrgOrigin('acme', 'https://acme.spaces.test')
        const body = `![x](https://acme.spaces.test/s/${SPACE}/b/${hash}?name=x.png)`
        expect(rewriteBlobLinks(body, { orgId: 'acme', orgAddress: 'acme.spaces.test', spaceId: SPACE } as never))
            .toContain(`https://acme.spaces.test/v1/spaces/${SPACE}/blobs/${hash}`)
    })

    it('are read with the session cookie', async () => {
        const { fetchBlob } = await import('./spaces-presentation')
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x'))
        await fetchBlob('https://acme.spaces.test/v1/spaces/S/blobs/h')
        expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ credentials: 'include' })
        fetchSpy.mockRestore()
    })
})
