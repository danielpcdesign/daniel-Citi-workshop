import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DashboardPage, { DASHBOARD_POLL_MS } from './DashboardPage.jsx'
import { ApiError } from '../services/http.js'
import { getAttention, getBoard, getHotspots, getSummary, getTimings } from '../services/reportService.js'
import { ADMIN, ENGINEER, fakeAuth, incidentFixture, renderPage } from '../test/render.jsx'

vi.mock('../services/reportService.js', () => ({
    getSummary: vi.fn(),
    getBoard: vi.fn(),
    getAttention: vi.fn(),
    getHotspots: vi.fn(),
    getTimings: vi.fn(),
}))

const STATUSES = ['unassigned', 'open', 'in_progress', 'blocked', 'resolved', 'closed']

function summaryFixture(overrides = {})
{
    return {
        total: 14,
        by_status: { unassigned: 2, open: 3, in_progress: 4, blocked: 1, resolved: 2, closed: 2 },
        by_priority: { low: 3, medium: 6, high: 4, critical: 1 },
        by_category: { electrical: 0, plumbing: 7, hvac: 2, cleaning: 0, furniture: 0, access_security: 0, network: 5, hardware: 0, software: 0, other: 0 },
        by_escalation: { none: 12, pending: 1, granted: 1, declined: 0 },
        oldest_active: { id: 3, title: 'Lift stuck on floor 2', created_at: '2026-09-01T09:00:00+00:00', age_seconds: 900000 },
        ...overrides,
    }
}

// the board as the service returns it: every status, a few cards each, and the server's total
function boardFixture()
{
    return STATUSES.map((status) =>
    {
        if (status === 'open')
        {
            return { status, total: 9, items: [incidentFixture({ id: 21, title: 'Door sensor dead', status, priority: 'critical', assignee_name: 'Eli Engineer' })] }
        }
        if (status === 'blocked')
        {
            return { status, total: 1, items: [incidentFixture({ id: 22, title: 'Radiator cold', status, escalation_status: 'pending' })] }
        }
        return { status, total: 0, items: [] }
    })
}

const ATTENTION = {
    blocked: [{ id: 22, title: 'Radiator cold', assignee_id: 41, assignee_name: 'Eli Engineer', blocked_since: '2026-09-20T09:00:00+00:00', reason: 'Waiting for a valve' }],
    escalated: [
        { id: 30, title: 'Flooded kitchen', escalation_status: 'pending', requested_at: '2026-09-21T09:00:00+00:00', reason: 'Water near sockets' },
        { id: 31, title: 'No heating', escalation_status: 'granted', requested_at: null, reason: null },
    ],
}

const HOTSPOTS = {
    buildings: [{ id: 1, name: 'Live HQ', parent_id: null, archived: false, incidents: 8 }, { id: 2, name: 'Old wing', parent_id: null, archived: true, incidents: 2 }],
    floors: [{ id: 5, name: 'Floor 3', parent_id: 1, archived: false, incidents: 6 }, { id: 6, name: 'Floor 9', parent_id: 99, archived: false, incidents: 1 }],
    seats: [{ id: 9, name: 'Desk 14', parent_id: 5, archived: false, incidents: 3 }],
}

const TIMINGS = {
    time_to_assign: { count: 12, median_seconds: 5400, average_seconds: 7260 },
    time_to_acknowledge: { count: 1, median_seconds: 90061, average_seconds: 90061 },
    time_to_resolve: { count: 0, median_seconds: null, average_seconds: null },
}

function renderAs(user)
{
    return renderPage(<DashboardPage />, { route: '/dashboard', auth: fakeAuth({ user }) })
}

beforeEach(() =>
{
    getSummary.mockResolvedValue(summaryFixture())
    getBoard.mockResolvedValue(boardFixture())
    getAttention.mockResolvedValue(ATTENTION)
    getHotspots.mockResolvedValue(HOTSPOTS)
    getTimings.mockResolvedValue(TIMINGS)
})

afterEach(() =>
{
    vi.useRealTimers()
})

describe('DashboardPage for an admin', () =>
{
    it('shows the summary plate with the counts that need action', async () =>
    {
        renderAs(ADMIN)
        expect(screen.getByText('Loading the summary')).toBeInTheDocument()
        const plate = await screen.findByRole('region', { name: 'Right now' })
        expect(plate).toHaveTextContent('Every ticket across all buildings.')
        // unassigned + open + in progress + blocked; resolved waits on an admin and is counted apart
        const figure = (label) => within(plate).getByText(label).closest('div')
        expect(figure('Open work')).toHaveTextContent('10')
        expect(figure('Waiting for an engineer')).toHaveTextContent('2')
        expect(figure('Escalation requested')).toHaveTextContent('1')
        expect(figure('Fixed, waiting to close')).toHaveTextContent('2')
        expect(within(plate).getByRole('link', { name: 'INC-3 Lift stuck on floor 2' })).toHaveAttribute('href', '/incidents/3')
    })

    it('lists blocked tickets and escalations with their reasons', async () =>
    {
        renderAs(ADMIN)
        const section = await screen.findByRole('region', { name: 'Needs attention' })
        const blocked = await within(section).findByRole('list', { name: /Blocked/ })
        expect(blocked).toHaveTextContent('Waiting for a valve')
        expect(blocked).toHaveTextContent('Eli Engineer')
        expect(within(blocked).getByRole('link')).toHaveAttribute('href', '/incidents/22')
        const escalated = within(section).getByRole('list', { name: /Escalations/ })
        expect(escalated).toHaveTextContent('Waiting for your decision')
        expect(escalated).toHaveTextContent('Water near sockets')
        expect(escalated).toHaveTextContent('Escalated')
        expect(escalated).toHaveTextContent('The reporter removed their reason.')
    })

    it('groups the board by status in workflow order, with blocked marked and a count of what is hidden', async () =>
    {
        renderAs(ADMIN)
        const board = await screen.findByRole('region', { name: 'Tickets by status' })
        const columns = await within(board).findAllByRole('region')
        expect(columns.map((column) => column.dataset.status)).toEqual(STATUSES)

        const open = within(board).getByRole('region', { name: 'Open' })
        expect(within(open).getByRole('link', { name: /Door sensor dead/ })).toHaveAttribute('href', '/incidents/21')
        expect(open).toHaveTextContent('9 tickets')
        expect(open).toHaveTextContent('+8 more not shown')
        expect(open).toHaveTextContent('Critical')

        const blocked = within(board).getByRole('region', { name: 'Blocked' })
        expect(within(blocked).getByRole('heading', { name: 'Blocked' })).toHaveStyle({ color: 'rgb(180, 35, 24)' })
        expect(blocked).toHaveTextContent('Escalation requested')
        expect(within(board).getByRole('region', { name: 'Closed' })).toHaveTextContent('None')
    })

    it('shows timings as readable durations and hotspots by place', async () =>
    {
        renderAs(ADMIN)
        const timings = await screen.findByRole('list', { name: 'Typical time after a ticket is reported' })
        expect(timings).toHaveTextContent('1 hour 30 minutes')
        expect(timings).toHaveTextContent('Median of 12 tickets; average 2 hours 1 minute')
        expect(timings).toHaveTextContent('1 day 1 hour')
        expect(timings).toHaveTextContent('Median of 1 ticket;')
        expect(timings).toHaveTextContent('Not measured yet')

        const hotspots = screen.getByRole('region', { name: 'Where problems recur' })
        expect(within(hotspots).getByRole('list', { name: 'Incidents by buildings' })).toHaveTextContent('Old wing (archived)')
        const floors = within(hotspots).getByRole('list', { name: 'Incidents by floors' })
        expect(floors).toHaveTextContent('Live HQ, Floor 3')
        expect(floors).toHaveTextContent('Floor 9')
        expect(within(hotspots).getByRole('list', { name: 'Incidents by seats' })).toHaveTextContent('Floor 3, Desk 14')
    })

    it('breaks counts down by kind of problem, most common first, and by priority', async () =>
    {
        renderAs(ADMIN)
        const kinds = await screen.findByRole('list', { name: 'Tickets by kind of problem' })
        expect(within(kinds).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Plumbing7', 'Network5', 'Heating and air2'])
        const priorities = screen.getByRole('list', { name: 'Tickets by priority' })
        expect(within(priorities).getAllByRole('listitem')[0]).toHaveTextContent('Critical1')
    })

    it('refreshes live views every 30 seconds, and timings and hotspots only on request', async () =>
    {
        vi.useFakeTimers()
        renderAs(ADMIN)
        await act(async () => undefined)
        expect(DASHBOARD_POLL_MS).toBe(30000)
        for (const loader of [getSummary, getBoard, getAttention, getTimings, getHotspots])
        {
            expect(loader).toHaveBeenCalledTimes(1)
        }
        await act(async () => vi.advanceTimersByTime(DASHBOARD_POLL_MS))
        expect(getSummary).toHaveBeenCalledTimes(2)
        expect(getBoard).toHaveBeenCalledTimes(2)
        expect(getAttention).toHaveBeenCalledTimes(2)
        expect(getTimings).toHaveBeenCalledTimes(1)
        expect(getHotspots).toHaveBeenCalledTimes(1)

        vi.useRealTimers()
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Refresh timings' }))
        await user.click(screen.getByRole('button', { name: 'Refresh hotspots' }))
        expect(getTimings).toHaveBeenCalledTimes(2)
        expect(getHotspots).toHaveBeenCalledTimes(2)
    })

    it('shows a failed report with its reference and a retry, without blanking the rest', async () =>
    {
        const user = userEvent.setup()
        getBoard.mockRejectedValueOnce(new ApiError({ status: 500, code: 'internal', message: 'boom', requestId: 'req-77' }))
        renderAs(ADMIN)
        const board = await screen.findByRole('region', { name: 'Tickets by status' })
        expect(await within(board).findByRole('alert')).toHaveTextContent('Quote reference req-77')
        expect(await screen.findByRole('region', { name: 'Right now' })).toBeInTheDocument()
        await user.click(within(board).getByRole('button', { name: 'Try again' }))
        expect(await within(board).findByRole('region', { name: 'Open' })).toBeInTheDocument()
    })

    it('shows a summary failure once, above where the plate goes', async () =>
    {
        getSummary.mockRejectedValue(new ApiError({ status: 0, code: 'network', message: 'x' }))
        renderAs(ADMIN)
        await screen.findByRole('region', { name: 'Tickets by status' })
        const alerts = await screen.findAllByRole('alert')
        expect(alerts).toHaveLength(1)
        expect(alerts[0]).toHaveTextContent('Could not reach the server')
    })

    it('says so when there is nothing to show', async () =>
    {
        getSummary.mockResolvedValue(summaryFixture({
            by_status: { unassigned: 0, open: 0, in_progress: 0, blocked: 0, resolved: 0, closed: 0 },
            by_priority: { low: 0, medium: 0, high: 0, critical: 0 },
            by_category: { plumbing: 0 },
            by_escalation: { none: 0, pending: 0, granted: 0, declined: 0 },
            oldest_active: null,
        }))
        getAttention.mockResolvedValue({ blocked: [], escalated: [] })
        renderAs(ADMIN)
        expect(await screen.findByText('No open tickets. Everything reported has been fixed.')).toBeInTheDocument()
        expect(await screen.findByText('Nothing is blocked.')).toBeInTheDocument()
        expect(screen.getByText('No escalation requests are waiting.')).toBeInTheDocument()
        expect(screen.getAllByText('No tickets yet.')).toHaveLength(2)
    })
})

describe('DashboardPage for an engineer', () =>
{
    it('shows their own summary and board, and never asks for admin reports', async () =>
    {
        renderAs(ENGINEER)
        const plate = await screen.findByRole('region', { name: 'Right now' })
        expect(plate).toHaveTextContent('Tickets assigned to you or reported by you.')
        expect(await screen.findByRole('region', { name: 'Tickets by status' })).toBeInTheDocument()
        expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument()
        expect(screen.queryByRole('region', { name: 'How fast tickets move' })).not.toBeInTheDocument()
        expect(screen.queryByRole('region', { name: 'Where problems recur' })).not.toBeInTheDocument()
        expect(getAttention).not.toHaveBeenCalled()
        expect(getTimings).not.toHaveBeenCalled()
        expect(getHotspots).not.toHaveBeenCalled()
    })

    it('lets the board scroll sideways on a phone', async () =>
    {
        globalThis.__screenWidth = 375
        renderAs(ENGINEER)
        const board = await screen.findByRole('region', { name: 'Tickets by status' })
        const open = await within(board).findByRole('region', { name: 'Open' })
        expect(open.parentElement.dataset.layout).toBe('scroll')
    })
})
