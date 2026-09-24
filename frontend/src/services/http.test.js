import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    ApiError,
    buildUrl,
    getAccessToken,
    http,
    refreshSession,
    request,
    setAccessToken,
    setSessionListener,
    sha256Hex,
} from './http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// sha256("") — the value AWS expects for an empty body
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function json(status, body)
{
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function envelope(status, code, extra = {})
{
    return json(status, { error: { code, message: `${code} happened`, request_id: 'req-1', ...extra } })
}

function headersOf(call)
{
    return call[1].headers
}

let fetchMock

beforeEach(() =>
{
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    setAccessToken(null)
    setSessionListener(null)
})

afterEach(() =>
{
    vi.unstubAllGlobals()
})

describe('buildUrl', () =>
{
    it('repeats keys for arrays and drops empty values', () =>
    {
        const url = buildUrl('/api/incidents', { status: ['open', 'blocked'], q: '', page: 2, x: null })
        expect(url).toBe('/api/incidents?status=open&status=blocked&page=2')
    })

    it('leaves a path without a query untouched', () =>
    {
        expect(buildUrl('/api/incidents')).toBe('/api/incidents')
    })
})

describe('request headers', () =>
{
    it('sends the access token as X-Access-Token, never Authorization', async () =>
    {
        setAccessToken('tok-1')
        fetchMock.mockResolvedValueOnce(json(200, { ok: true }))
        await http.get('/api/auth/me')
        const headers = headersOf(fetchMock.mock.calls[0])
        expect(headers['X-Access-Token']).toBe('tok-1')
        expect(headers.Authorization).toBeUndefined()
        expect(fetchMock.mock.calls[0][1].credentials).toBe('same-origin')
    })

    it('sends a fresh UUID correlation id per call, or the one given for the action', async () =>
    {
        fetchMock.mockImplementation(async () => json(200, {}))
        await http.get('/api/a')
        await http.get('/api/b')
        await http.get('/api/c', { correlationId: '11111111-1111-4111-8111-111111111111' })
        const ids = fetchMock.mock.calls.map((call) => headersOf(call)['X-Correlation-Id'])
        expect(ids[0]).toMatch(UUID)
        expect(ids[1]).toMatch(UUID)
        expect(ids[0]).not.toBe(ids[1])
        expect(ids[2]).toBe('11111111-1111-4111-8111-111111111111')
    })

    it('hashes the exact body string it sends on POST and PUT', async () =>
    {
        fetchMock.mockImplementation(async () => json(200, {}))
        await http.post('/api/incidents/1/notes', { body: 'Leak by the lifts' })
        await http.put('/api/incidents/1/notes/2', { body: 'Leak by lift B' })
        for (const call of fetchMock.mock.calls)
        {
            const sent = call[1].body
            expect(headersOf(call)['x-amz-content-sha256']).toBe(await sha256Hex(sent))
            expect(headersOf(call)['Content-Type']).toBe('application/json')
        }
    })

    it('hashes the empty string for an empty-body POST', async () =>
    {
        fetchMock.mockResolvedValueOnce(json(200, { access_token: 't', user: { id: 1 } }))
        await refreshSession()
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('/api/auth/refresh')
        expect(init.body).toBeUndefined()
        expect(init.headers['x-amz-content-sha256']).toBe(EMPTY_SHA)
    })

    it('sends no body hash on GET or DELETE', async () =>
    {
        fetchMock.mockResolvedValueOnce(json(200, {}))
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        await http.get('/api/x')
        await http.del('/api/x/1')
        for (const call of fetchMock.mock.calls)
        {
            expect(headersOf(call)['x-amz-content-sha256']).toBeUndefined()
        }
    })
})

describe('responses', () =>
{
    it('returns null for 204', async () =>
    {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        expect(await http.del('/api/incidents/1/notes/3')).toBeNull()
    })

    it('parses the error envelope into an ApiError', async () =>
    {
        fetchMock.mockResolvedValueOnce(envelope(400, 'validation_failed', { fields: { title: 'must not be empty' } }))
        const error = await http.post('/api/incidents', {}).catch((e) => e)
        expect(error).toBeInstanceOf(ApiError)
        expect(error).toMatchObject({
            status: 400,
            code: 'validation_failed',
            message: 'validation_failed happened',
            fields: { title: 'must not be empty' },
            requestId: 'req-1',
        })
    })

    it('maps a non-envelope error page to a generic code', async () =>
    {
        fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }))
        const error = await http.get('/api/x').catch((e) => e)
        expect(error).toMatchObject({ status: 502, code: 'internal', fields: null, requestId: null })

        fetchMock.mockResolvedValueOnce(new Response('nope', { status: 418 }))
        const teapot = await http.get('/api/x').catch((e) => e)
        expect(teapot.code).toBe('unexpected')
    })

    it('turns a failed fetch into code "network"', async () =>
    {
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
        const error = await http.get('/api/x').catch((e) => e)
        expect(error).toMatchObject({ status: 0, code: 'network' })
    })
})

describe('401 handling', () =>
{
    it('refreshes once and retries once with the new token and the same correlation id', async () =>
    {
        setAccessToken('old')
        fetchMock
            .mockResolvedValueOnce(envelope(401, 'unauthenticated'))
            .mockResolvedValueOnce(json(200, { access_token: 'new', user: { id: 7 } }))
            .mockResolvedValueOnce(json(200, { id: 42 }))
        const listener = vi.fn()
        setSessionListener(listener)

        const result = await http.get('/api/incidents/42')

        expect(result).toEqual({ id: 42 })
        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh')
        expect(headersOf(fetchMock.mock.calls[1])['X-Access-Token']).toBeUndefined()
        expect(headersOf(fetchMock.mock.calls[2])['X-Access-Token']).toBe('new')
        const ids = fetchMock.mock.calls.map((call) => headersOf(call)['X-Correlation-Id'])
        expect(new Set(ids).size).toBe(1)
        expect(listener).toHaveBeenCalledWith({ user: { id: 7 } })
    })

    it('two concurrent 401s cause exactly one refresh', async () =>
    {
        setAccessToken('old')
        let refreshCalls = 0
        fetchMock.mockImplementation(async (url, init) =>
        {
            if (url === '/api/auth/refresh')
            {
                refreshCalls += 1
                return json(200, { access_token: 'new', user: { id: 1 } })
            }
            if (init.headers['X-Access-Token'] === 'new')
            {
                return json(200, { url })
            }
            return envelope(401, 'unauthenticated')
        })

        const [a, b] = await Promise.all([http.get('/api/a'), http.get('/api/b')])

        expect(refreshCalls).toBe(1)
        expect(a).toEqual({ url: '/api/a' })
        expect(b).toEqual({ url: '/api/b' })
    })

    it('does not retry a second time when the retried call is also 401', async () =>
    {
        fetchMock
            .mockResolvedValueOnce(envelope(401, 'unauthenticated'))
            .mockResolvedValueOnce(json(200, { access_token: 'new', user: { id: 1 } }))
            .mockResolvedValueOnce(envelope(401, 'unauthenticated'))
        const error = await http.get('/api/x').catch((e) => e)
        expect(error.status).toBe(401)
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('ends the session when the refresh itself fails', async () =>
    {
        setAccessToken('old')
        const listener = vi.fn()
        setSessionListener(listener)
        fetchMock
            .mockResolvedValueOnce(envelope(401, 'unauthenticated'))
            .mockResolvedValueOnce(envelope(401, 'unauthenticated'))
        const error = await http.get('/api/x').catch((e) => e)
        expect(error.status).toBe(401)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(getAccessToken()).toBeNull()
        expect(listener).toHaveBeenCalledWith(null)
    })

    it('never retries the refresh call itself', async () =>
    {
        fetchMock.mockImplementation(async () => envelope(401, 'unauthenticated'))
        await expect(request('POST', '/api/auth/refresh')).rejects.toMatchObject({ status: 401 })
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not refresh when the caller opts out (login) or the error is not an expired token', async () =>
    {
        fetchMock.mockResolvedValueOnce(envelope(401, 'unauthenticated'))
        await expect(http.post('/api/auth/login', {}, { retry: false })).rejects.toMatchObject({ status: 401 })
        fetchMock.mockResolvedValueOnce(envelope(403, 'forbidden'))
        await expect(http.get('/api/x')).rejects.toMatchObject({ status: 403 })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('shares one refresh between concurrent refreshSession callers (StrictMode boot)', async () =>
    {
        fetchMock.mockImplementation(async () => json(200, { access_token: 't', user: { id: 1 } }))
        const [a, b] = await Promise.all([refreshSession(), refreshSession()])
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(a).toBe(b)
        expect(getAccessToken()).toBe('t')
        // settled: the next refresh is a new request
        await refreshSession()
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })
})
