import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webChannelHandlers } from './handlers'
import { APEX_URL } from './config'
import { loadOrgs } from './orgs'

vi.mock('./account', () => ({
    beginSignIn: vi.fn(),
    getAccessToken: vi.fn(async () => 'access-token'),
    hasSession: () => true,
}))
vi.mock('./session', () => ({ harborSession: {} }))
vi.mock('./orgs', () => ({
    getClient: vi.fn(),
    getLive: vi.fn(),
    onRuntimeReset: vi.fn(() => () => {}),
    onMemberFrame: vi.fn(() => () => {}),
    loadOrgs: vi.fn(),
}))

describe('creating a server in the web app', () => {
    const org = {
        id: 'new-org', name: 'towerk', address: 'towerk-ab12.spaces.test',
        baseUrl: 'https://towerk-ab12.spaces.test', memberId: 'founder', authKind: 'session' as const,
    }
    const fetchMock = vi.fn<typeof fetch>()
    const create = () => webChannelHandlers(vi.fn())['spaces:createOrg']!({ name: 'towerk' })

    beforeEach(() => {
        fetchMock.mockReset()
        vi.stubGlobal('fetch', fetchMock)
        vi.mocked(loadOrgs).mockReset().mockResolvedValue([org])
    })
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('sends the display name and a valid generated slug, then returns the listed org', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ org: { id: org.id } }), { status: 201 }))

        await expect(create()).resolves.toEqual({ org })

        expect(fetchMock).toHaveBeenCalledOnce()
        const [url, init] = fetchMock.mock.calls[0]!
        expect(url).toBe(`${APEX_URL}/v1/orgs`)
        expect(init).toMatchObject({
            method: 'POST',
            headers: { authorization: 'Bearer access-token', 'content-type': 'application/json' },
        })
        expect(JSON.parse(init!.body as string)).toEqual({ name: 'towerk', slug: expect.stringMatching(/^towerk-[a-z0-9]{4}$/) })
        expect(loadOrgs).toHaveBeenCalledOnce()
    })

    it('retries a taken address with a fresh slug and the same display name', async () => {
        const random = vi.spyOn(Math, 'random').mockReturnValue(0)
        fetchMock.mockImplementationOnce(async () => {
            random.mockReturnValue(0.5)
            return new Response(JSON.stringify({ message: '"towerk-aaaa" is taken' }), { status: 400 })
        }).mockResolvedValueOnce(new Response(JSON.stringify({ org: { id: org.id } }), { status: 201 }))

        await expect(create()).resolves.toEqual({ org })

        expect(fetchMock).toHaveBeenCalledTimes(2)
        const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init!.body as string))
        expect(bodies[0].name).toBe('towerk')
        expect(bodies[1].name).toBe('towerk')
        expect(bodies[1].slug).not.toBe(bodies[0].slug)
        expect(loadOrgs).toHaveBeenCalledOnce()
    })

    it('stops after three taken addresses', async () => {
        fetchMock.mockImplementation(async () => new Response(JSON.stringify({ message: '"slug" is taken' }), { status: 400 }))

        await expect(create()).rejects.toThrow('"slug" is taken')
        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(loadOrgs).not.toHaveBeenCalled()
    })

    it('surfaces other server errors immediately', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'name must be 1–128 characters' }), { status: 400 }))

        await expect(create()).rejects.toThrow('name must be 1–128 characters')
        expect(fetchMock).toHaveBeenCalledOnce()
        expect(loadOrgs).not.toHaveBeenCalled()
    })

    it('does not retry a creation that succeeded but is not listed yet', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ org: { id: org.id } }), { status: 201 }))
        vi.mocked(loadOrgs).mockResolvedValue([])

        await expect(create()).rejects.toThrow('The server was created but is not listed yet.')
        expect(fetchMock).toHaveBeenCalledOnce()
    })
})
