import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DashboardPage from './DashboardPage.jsx'
import { ApiError } from '../services/http.js'
import { listIncidents } from '../services/incidentService.js'
import { getAttention, getBoard, getFlow, getHotspots, getSummary, getTimings } from '../services/reportService.js'
import { ADMIN, ENGINEER, fakeAuth, incidentFixture, renderPage } from '../test/render.jsx'

vi.mock('../services/reportService.js', () => ({
    getSummary: vi.fn(),
    getBoard: vi.fn(),
    getAttention: vi.fn(),
    getHotspots: vi.fn(),
    getTimings: vi.fn(),
    getFlow: vi.fn(),
}))
vi.mock('../services/incidentService.js', () => ({ listIncidents: vi.fn(), getIncident: vi.fn() }))
vi.mock('../services/facilityService.js', () => ({ listBuildings: vi.fn() }))
vi.mock('../services/engineerService.js', () => ({ listEngineers: vi.fn() }))
// jsdom cannot measure an svg chart; the stand-in shows what the chart was given
vi.mock('@mui/x-charts/LineChart', () => ({
    LineChart: ({ dataset, series }) => (
        <div data-testid="chart" data-points={dataset.length} data-series={series.map((one) => `${one.label}:${one.stack}:${one.area}:${one.curve}`).join('|')}>
            {dataset.map((point) => point.time.toISOString()).join(' ')}
        </div>
    ),
}))

const NOW = new Date(2026, 8, 24, 13, 30)

function hourly(hours, counts)
{
    const start = new Date(NOW.getTime() - hours * 3600000)
    return Array.from({ length: hours }, (unused, index) => ({ at: new Date(start.getTime() + (index + 1) * 3600000).toISOString(), ...counts }))
}

const COUNTS = { unassigned: 3, open: 2, in_progress: 1, blocked: 1, resolved: 0, closed: 4 }
const FLOW = { bucket: 'hour', statuses: Object.keys(COUNTS), points: hourly(10 * 24, COUNTS) }

function summary()
{
    return {
        total: 11,
        by_status: { unassigned: 3, open: 2, in_progress: 1, blocked: 1, resolved: 2, closed: 4 },
        by_priority: { low: 0, medium: 0, high: 0, critical: 0 },
        by_category: {},
        by_escalation: { none: 10, pending: 1, granted: 0, declined: 0 },
        oldest_active: null,
    }
}

function renderAs(user)
{
    return renderPage(<DashboardPage />, { route: '/dashboard', auth: fakeAuth({ user }) })
}

beforeEach(() =>
{
    // only Date is faked: timers stay real, so the page's own waits and user events behave normally
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    getSummary.mockResolvedValue(summary())
    getBoard.mockResolvedValue([])
    getAttention.mockResolvedValue({ blocked: [], escalated: [] })
    getHotspots.mockResolvedValue({ buildings: [], floors: [], seats: [] })
    getTimings.mockResolvedValue({
        time_to_assign: { count: 0, median_seconds: null, average_seconds: null },
        time_to_acknowledge: { count: 0, median_seconds: null, average_seconds: null },
        time_to_resolve: { count: 0, median_seconds: null, average_seconds: null },
    })
    getFlow.mockResolvedValue(FLOW)
    listIncidents.mockImplementation(async (query) => ({
        items: [incidentFixture({ id: 7, title: 'Radiator cold', status: 'blocked' })],
        total: 1,
        page: query.page,
        limit: 20,
    }))
})

afterEach(() =>
{
    vi.useRealTimers()
})

describe('Right now figures open the tickets behind them', () =>
{
    it('lists the blocked tickets in a drawer, and gives focus back to the figure on Escape', async () =>
    {
        const user = userEvent.setup()
        renderAs(ADMIN)
        const figure = await screen.findByRole('button', { name: 'Blocked: 1 ticket. Show them' })
        await user.click(figure)

        const drawer = await screen.findByRole('dialog', { name: 'Blocked (1)' })
        expect(listIncidents).toHaveBeenCalledWith({ status: ['blocked'], page: 1, limit: 20 })
        const card = await within(drawer).findByRole('link', { name: /Radiator cold/ })
        expect(card).toHaveAttribute('href', '/incidents/7')
        expect(card).toHaveTextContent('Blocked')

        await user.keyboard('{Escape}')
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(figure).toHaveFocus()
    })

    it('asks with the same filters the figure was counted with', async () =>
    {
        const user = userEvent.setup()
        renderAs(ADMIN)
        const cases = [
            ['Open work: 7 tickets. Show them', { status: ['unassigned', 'open', 'in_progress', 'blocked'] }],
            ['Waiting for an engineer: 3 tickets. Show them', { status: ['unassigned'] }],
            ['Escalation requested: 1 ticket. Show them', { escalation_status: 'pending' }],
            ['Fixed, waiting to close: 2 tickets. Show them', { status: ['resolved'] }],
        ]
        for (const [name, query] of cases)
        {
            await user.click(await screen.findByRole('button', { name }))
            await screen.findByRole('dialog')
            expect(listIncidents).toHaveBeenLastCalledWith({ ...query, page: 1, limit: 20 })
            await user.click(screen.getByRole('button', { name: 'Close' }))
            await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        }
    })

    it('pages through long lists, 20 at a time, and the title follows the server total', async () =>
    {
        const user = userEvent.setup()
        listIncidents.mockImplementation(async (query) => ({ items: [incidentFixture({ id: 100 + query.page })], total: 45, page: query.page, limit: 20 }))
        renderAs(ADMIN)
        await user.click(await screen.findByRole('button', { name: /^Open work/ }))
        const drawer = await screen.findByRole('dialog', { name: 'Open work (45)' })
        await user.click(await within(drawer).findByRole('button', { name: 'Go to page 3' }))
        expect(listIncidents).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }))
        expect(await within(drawer).findByRole('link', { name: /INC-103/ })).toBeInTheDocument()
    })

    it('says when a figure has no tickets, and shows failures with their reference', async () =>
    {
        const user = userEvent.setup()
        listIncidents.mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 20 })
        renderAs(ADMIN)
        await user.click(await screen.findByRole('button', { name: /^Fixed, waiting to close/ }))
        expect(await screen.findByText('No tickets here right now.')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Close' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

        listIncidents.mockRejectedValueOnce(new ApiError({ status: 500, code: 'internal', message: 'boom', requestId: 'req-4' }))
        await user.click(screen.getByRole('button', { name: /^Blocked/ }))
        const drawer = await screen.findByRole('dialog')
        expect(await within(drawer).findByRole('alert')).toHaveTextContent('Quote reference req-4')
        await user.click(within(drawer).getByRole('button', { name: 'Try again' }))
        expect(await within(drawer).findByRole('link', { name: /Radiator cold/ })).toBeInTheDocument()
    })

    it('works the same for an engineer, whose lists the server scopes', async () =>
    {
        const user = userEvent.setup()
        globalThis.__screenWidth = 375
        renderAs(ENGINEER)
        await user.click(await screen.findByRole('button', { name: /^Blocked/ }))
        expect(await screen.findByRole('dialog', { name: 'Blocked (1)' })).toBeInTheDocument()
        expect(listIncidents).toHaveBeenCalledWith({ status: ['blocked'], page: 1, limit: 20 })
    })
})

describe('How work flows', () =>
{
    it('sits after the timings in the nav and shows the last snapshot in words', async () =>
    {
        renderAs(ADMIN)
        const nav = screen.getByRole('navigation', { name: 'Dashboard sections' })
        const labels = within(nav).getAllByRole('link').map((link) => link.textContent)
        expect(labels.indexOf('How work flows')).toBe(labels.indexOf('How fast tickets move') + 1)
        const section = await screen.findByRole('region', { name: 'How work flows' })
        expect(await within(section).findByText('Now: 3 unassigned, 2 open, 1 in progress, 1 blocked, 0 resolved, and 4 closed.')).toBeInTheDocument()
    })

    it('draws 7 days by default, one point a day, stacked with closed at the bottom', async () =>
    {
        renderAs(ADMIN)
        const chart = await screen.findByTestId('chart')
        expect(chart.dataset.points).toBe('7')
        expect(chart.dataset.series).toBe('Closed:total:true:linear|Resolved:total:true:linear|Blocked:total:true:linear|In progress:total:true:linear|Open:total:true:linear|Unassigned:total:true:linear')
        expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('switches ranges from the same response, without asking the server again', async () =>
    {
        const user = userEvent.setup()
        renderAs(ADMIN)
        await screen.findByTestId('chart')
        await user.click(screen.getByRole('button', { name: 'Today' }))
        // hourly since local midnight: the fixture's points fall on the half hour, 00:30 to 13:30, which is 14
        expect(Number(screen.getByTestId('chart').dataset.points)).toBe(14)
        await user.click(screen.getByRole('button', { name: 'Last 3 months' }))
        expect(screen.getByTestId('chart').dataset.points).toBe('11')
        // pressing the selected range again keeps it selected
        await user.click(screen.getByRole('button', { name: 'Last 3 months' }))
        expect(screen.getByRole('button', { name: 'Last 3 months' })).toHaveAttribute('aria-pressed', 'true')
        expect(getFlow).toHaveBeenCalledTimes(1)
    })

    it('says so when a range has no tickets', async () =>
    {
        const zero = { unassigned: 0, open: 0, in_progress: 0, blocked: 0, resolved: 0, closed: 0 }
        getFlow.mockResolvedValue({ ...FLOW, points: hourly(48, zero) })
        renderAs(ADMIN)
        expect(await screen.findByText('No tickets in this range.')).toBeInTheDocument()
        expect(screen.queryByTestId('chart')).not.toBeInTheDocument()
    })

    it('loads on demand, reloads on Refresh, and shows a failure with its reference', async () =>
    {
        const user = userEvent.setup()
        getFlow.mockRejectedValueOnce(new ApiError({ status: 500, code: 'internal', message: 'boom', requestId: 'req-9' }))
        renderAs(ADMIN)
        const section = await screen.findByRole('region', { name: 'How work flows' })
        expect(await within(section).findByRole('alert')).toHaveTextContent('Quote reference req-9')
        await user.click(within(section).getByRole('button', { name: 'Refresh flow' }))
        expect(await within(section).findByTestId('chart')).toBeInTheDocument()
        expect(getFlow).toHaveBeenCalledTimes(2)
    })

    it('is not shown to an engineer, who never asks for it', async () =>
    {
        renderAs(ENGINEER)
        await screen.findByRole('region', { name: 'Right now' })
        expect(screen.queryByRole('region', { name: 'How work flows' })).not.toBeInTheDocument()
        expect(getFlow).not.toHaveBeenCalled()
    })
})
