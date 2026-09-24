import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, setAccessToken } from './http.js'
import { BOARD_COLUMN_LIMIT, BOARD_STATUSES, getAttention, getBoard, getHotspots, getSummary, getTimings } from './reportService.js'

let fetchMock

function json(body, status = 200)
{
    return new Response(JSON.stringify(body), { status })
}

function calls()
{
    return fetchMock.mock.calls.map(([url, init]) => ({ url, method: init.method, correlationId: init.headers['X-Correlation-Id'] }))
}

beforeEach(() =>
{
    fetchMock = vi.fn().mockImplementation(async () => json({}))
    vi.stubGlobal('fetch', fetchMock)
    setAccessToken('tok')
})

afterEach(() =>
{
    vi.unstubAllGlobals()
    setAccessToken(null)
})

describe('reportService', () =>
{
    it('maps each report to its endpoint, with repeatable status filters', async () =>
    {
        await getSummary()
        await getHotspots({ status: ['open', 'blocked'], limit: 5 })
        await getTimings({ status: ['closed'] })
        await getAttention()
        expect(calls().map((call) => call.url)).toEqual([
            '/api/reports/summary',
            '/api/reports/hotspots?status=open&status=blocked&limit=5',
            '/api/reports/timings?status=closed',
            '/api/reports/attention',
        ])
        expect(calls().every((call) => call.method === 'GET')).toBe(true)
    })

    it('builds the board from one list request per status, keeping each total', async () =>
    {
        fetchMock.mockImplementation(async (url) =>
        {
            const status = new URL(url, 'http://x').searchParams.get('status')
            return json({ items: [{ id: status }], total: status === 'open' ? 9 : 1, page: 1, limit: BOARD_COLUMN_LIMIT })
        })
        const columns = await getBoard()
        expect(columns.map((column) => column.status)).toEqual(BOARD_STATUSES)
        expect(columns[1]).toEqual({ status: 'open', items: [{ id: 'open' }], total: 9 })

        const urls = calls().map((call) => call.url)
        expect(urls).toContain(`/api/incidents?status=unassigned&limit=${BOARD_COLUMN_LIMIT}`)
        // finished work newest first; live work keeps the server's triage order
        expect(urls).toContain(`/api/incidents?status=closed&sort=-updated_at&limit=${BOARD_COLUMN_LIMIT}`)
        // one refresh, one correlation id across its six requests (AD-16)
        expect(new Set(calls().map((call) => call.correlationId)).size).toBe(1)
    })

    it('passes the server error envelope through', async () =>
    {
        fetchMock.mockImplementation(async () => json({ error: { code: 'forbidden', message: 'admins only', request_id: 'r-1' } }, 403))
        await expect(getTimings()).rejects.toBeInstanceOf(ApiError)
        await expect(getAttention()).rejects.toMatchObject({ status: 403, code: 'forbidden', requestId: 'r-1' })
    })
})
