import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DashboardPage from './DashboardPage.jsx'
import { ApiError } from '../services/http.js'
import { listEngineers } from '../services/engineerService.js'
import { listBuildings } from '../services/facilityService.js'
import { getIncident, listIncidents } from '../services/incidentService.js'
import { getAttention, getBoard, getHotspots, getSummary, getTimings } from '../services/reportService.js'
import { ADMIN, ENGINEER, fakeAuth, incidentFixture, renderPage } from '../test/render.jsx'

vi.mock('../services/reportService.js', () => ({
    getSummary: vi.fn(),
    getBoard: vi.fn(),
    getAttention: vi.fn(),
    getHotspots: vi.fn(),
    getTimings: vi.fn(),
}))
vi.mock('../services/incidentService.js', () => ({ listIncidents: vi.fn(), getIncident: vi.fn() }))
vi.mock('../services/facilityService.js', () => ({ listBuildings: vi.fn() }))
vi.mock('../services/engineerService.js', () => ({ listEngineers: vi.fn() }))

const DEFAULT_QUERY = { sort: '-priority,created_at', page: 1, limit: 20 }
const ROWS = [
    incidentFixture({ id: 12, title: 'Kitchen tap leaking', assignee_name: 'Eli Engineer', status: 'open' }),
    incidentFixture({ id: 30, title: 'Switch port flapping in Rack 30', category: 'network', priority: 'critical', status: 'blocked' }),
]

function page(items, total = items.length, pageNumber = 1)
{
    return { items, total, page: pageNumber, limit: 20 }
}

function renderAs(user)
{
    return renderPage(<DashboardPage />, { route: '/dashboard', auth: fakeAuth({ user }) })
}

function navLinks()
{
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' })
    return within(nav).getAllByRole('link').map((link) => link.textContent)
}

function lookupToggle()
{
    return screen.getByRole('button', { name: /Look up a ticket/ })
}

// by id: inside a closed lookup the toggle is hidden, and a hidden element has no accessible name to query by
function historyToggle()
{
    return document.getElementById('dash-history-summary')
}

async function openLookup(user)
{
    await user.click(lookupToggle())
    return screen.findByRole('list', { name: 'Lookup results' })
}

async function choose(user, label, option)
{
    await user.click(screen.getByRole('combobox', { name: label }))
    await user.click(await screen.findByRole('option', { name: option }))
}

let scrolled

beforeEach(() =>
{
    getSummary.mockResolvedValue({
        total: 2,
        by_status: { unassigned: 0, open: 1, in_progress: 0, blocked: 1, resolved: 0, closed: 0 },
        by_priority: { low: 0, medium: 1, high: 0, critical: 1 },
        by_category: { plumbing: 1, network: 1 },
        by_escalation: { none: 2, pending: 0, granted: 0, declined: 0 },
        oldest_active: null,
    })
    getBoard.mockResolvedValue([])
    getAttention.mockResolvedValue({ blocked: [], escalated: [] })
    getHotspots.mockResolvedValue({ buildings: [], floors: [], seats: [] })
    getTimings.mockResolvedValue({
        time_to_assign: { count: 0, median_seconds: null, average_seconds: null },
        time_to_acknowledge: { count: 0, median_seconds: null, average_seconds: null },
        time_to_resolve: { count: 0, median_seconds: null, average_seconds: null },
    })
    listIncidents.mockResolvedValue(page(ROWS))
    getIncident.mockImplementation(async (id) => incidentFixture({
        id,
        title: 'Kitchen tap leaking',
        status: 'open',
        history: [
            { from: null, to: 'unassigned', at: '2026-09-20T09:00:00+00:00', actor_id: 40, actor_name: 'Erin Employee', assignee_id: null, assignee_name: null, reason: null },
            { from: 'unassigned', to: 'open', at: '2026-09-21T09:00:00+00:00', actor_id: 42, actor_name: 'Ada Admin', assignee_id: 41, assignee_name: 'Eli Engineer', reason: null },
        ],
    }))
    listBuildings.mockResolvedValue(page([{ id: 1, name: 'Live HQ' }, { id: 2, name: 'Annex' }]))
    listEngineers.mockResolvedValue(page([{ id: 7, full_name: 'Eli Engineer' }]))
    // jsdom lays nothing out, so it has no scrolling; record where the page was asked to go
    scrolled = []
    Element.prototype.scrollIntoView = function scrollIntoView()
    {
        scrolled.push(this.id)
    }
})

afterEach(() =>
{
    delete Element.prototype.scrollIntoView
})

describe('Dashboard section nav', () =>
{
    it('lists every admin section in page order, with history under the lookup', async () =>
    {
        renderAs(ADMIN)
        await screen.findByRole('region', { name: 'Right now' })
        expect(navLinks()).toEqual([
            'Needs attention / Right now',
            'Tickets by status',
            'How fast tickets move',
            'Where problems occur',
            'Lookup tool',
            'History',
        ])
        expect(screen.getByRole('link', { name: 'Needs attention / Right now' })).toHaveAttribute('aria-current', 'location')
    })

    it('lists only the sections an engineer has', async () =>
    {
        renderAs(ENGINEER)
        await screen.findByRole('region', { name: 'Right now' })
        expect(navLinks()).toEqual(['Right now', 'Tickets by status', 'Lookup tool', 'History'])
    })

    it('opens a closed section before scrolling to it, and marks it as current', async () =>
    {
        const user = userEvent.setup()
        renderAs(ADMIN)
        expect(lookupToggle()).toHaveAttribute('aria-expanded', 'false')
        expect(historyToggle()).toHaveAttribute('aria-expanded', 'false')

        await user.click(screen.getByRole('link', { name: 'History' }))
        expect(lookupToggle()).toHaveAttribute('aria-expanded', 'true')
        expect(historyToggle()).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'location')
        await waitFor(() => expect(scrolled).toContain('dash-history'))
    })

    it('scrolls straight to a section that is always open', async () =>
    {
        const user = userEvent.setup()
        renderAs(ADMIN)
        await user.click(screen.getByRole('link', { name: 'How fast tickets move' }))
        await waitFor(() => expect(scrolled).toEqual(['dash-timings']))
        expect(document.activeElement).toHaveAttribute('id', 'dash-timings')
    })

    it('turns into one sideways row on a phone', async () =>
    {
        globalThis.__screenWidth = 375
        const user = userEvent.setup()
        renderAs(ENGINEER)
        await user.click(screen.getByRole('link', { name: 'Lookup tool' }))
        expect(lookupToggle()).toHaveAttribute('aria-expanded', 'true')
        expect(historyToggle()).toHaveAttribute('aria-expanded', 'false')
        await waitFor(() => expect(scrolled).toContain('dash-lookup'))
    })
})

describe('Dashboard lookup tool', () =>
{
    it('asks the server for nothing until it is opened, then lists with the default sort', async () =>
    {
        const user = userEvent.setup()
        renderAs(ADMIN)
        await screen.findByRole('region', { name: 'Right now' })
        expect(listIncidents).not.toHaveBeenCalled()
        expect(listBuildings).not.toHaveBeenCalled()

        const results = await openLookup(user)
        expect(listIncidents).toHaveBeenLastCalledWith(DEFAULT_QUERY)
        expect(screen.getByText('2 tickets')).toBeInTheDocument()
        const rows = within(results).getAllByRole('listitem')
        expect(rows[1]).toHaveTextContent('INC-30 Switch port flapping in Rack 30')
        expect(rows[1]).toHaveTextContent('Blocked')
        expect(rows[1]).toHaveTextContent('Critical priority')
        expect(rows[1]).toHaveTextContent('Live HQ, Floor 3')
        expect(rows[1]).toHaveTextContent('No engineer yet')
        expect(rows[0]).toHaveTextContent('Eli Engineer')
        expect(rows[0]).toHaveTextContent(/Reported .* ago/)
        expect(within(rows[0]).getByRole('link', { name: 'Open INC-12 Kitchen tap leaking' })).toHaveAttribute('href', '/incidents/12')
    })

    it('sends each filter, the search text, the sort, and the page as server-side params', async () =>
    {
        const user = userEvent.setup()
        listIncidents.mockResolvedValue(page(ROWS, 45))
        renderAs(ADMIN)
        await openLookup(user)

        await user.type(screen.getByRole('searchbox', { name: 'Search tickets' }), '  rack ')
        await waitFor(() => expect(listIncidents).toHaveBeenLastCalledWith({ ...DEFAULT_QUERY, q: 'rack' }))
        // typing is debounced: one request for the settled text, not one per key
        expect(listIncidents.mock.calls.filter(([query]) => query.q !== undefined)).toHaveLength(1)

        await user.click(screen.getByRole('combobox', { name: 'Status' }))
        await user.click(await screen.findByRole('option', { name: 'Open' }))
        await user.click(screen.getByRole('option', { name: 'Blocked' }))
        await user.keyboard('{Escape}')
        await choose(user, 'Priority', 'High')
        await choose(user, 'Kind of problem', 'Network')
        await choose(user, 'Building', 'Annex')
        await choose(user, 'Engineer', 'Eli Engineer')
        await choose(user, 'Escalation', 'Escalation requested')
        await choose(user, 'Sort by', 'Oldest first')
        const filtered = {
            q: 'rack',
            status: ['open', 'blocked'],
            priority: 'high',
            category: 'network',
            building_id: '2',
            assignee_id: '7',
            escalation_status: 'pending',
            sort: 'created_at',
            page: 1,
            limit: 20,
        }
        await waitFor(() => expect(listIncidents).toHaveBeenLastCalledWith(filtered))

        await user.click(screen.getByRole('button', { name: 'Go to page 2' }))
        await waitFor(() => expect(listIncidents).toHaveBeenLastCalledWith({ ...filtered, page: 2 }))
        // a new filter starts the list again at page 1
        await choose(user, 'Priority', 'Critical')
        await waitFor(() => expect(listIncidents).toHaveBeenLastCalledWith({ ...filtered, priority: 'critical' }))

        await user.click(screen.getByRole('button', { name: 'Clear filters' }))
        await waitFor(() => expect(listIncidents).toHaveBeenLastCalledWith({ ...DEFAULT_QUERY, sort: 'created_at' }))
        expect(screen.getByRole('button', { name: 'Clear filters' })).toBeDisabled()
    })

    it('hides the engineer filter from an engineer and never loads the engineer list', async () =>
    {
        const user = userEvent.setup()
        renderAs(ENGINEER)
        await openLookup(user)
        expect(screen.getByRole('combobox', { name: 'Building' })).toBeInTheDocument()
        expect(screen.queryByRole('combobox', { name: 'Engineer' })).not.toBeInTheDocument()
        expect(listEngineers).not.toHaveBeenCalled()
    })

    it('says when nothing matches and offers to clear the filters', async () =>
    {
        const user = userEvent.setup()
        renderAs(ADMIN)
        await openLookup(user)
        listIncidents.mockResolvedValue(page([]))
        await choose(user, 'Priority', 'Low')
        expect(await screen.findByText('No tickets match. Try other words, or fewer filters.')).toBeInTheDocument()
        expect(screen.getByText('0 tickets')).toBeInTheDocument()
        listIncidents.mockResolvedValue(page(ROWS))
        const clearButtons = screen.getAllByRole('button', { name: 'Clear filters' })
        await user.click(clearButtons[clearButtons.length - 1])
        expect(await screen.findByRole('list', { name: 'Lookup results' })).toBeInTheDocument()
    })

    it('shows an unexpected failure with its reference, and retries', async () =>
    {
        const user = userEvent.setup()
        listIncidents.mockRejectedValueOnce(new ApiError({ status: 500, code: 'internal', message: 'boom', requestId: 'req-9' }))
        listBuildings.mockRejectedValue(new ApiError({ status: 0, code: 'network', message: 'x' }))
        renderAs(ADMIN)
        await user.click(lookupToggle())
        const lookup = screen.getByRole('region', { name: /Look up a ticket/ })
        expect(await within(lookup).findByRole('alert')).toHaveTextContent('Quote reference req-9')
        expect(await within(lookup).findByText('Buildings could not be loaded.')).toBeInTheDocument()
        await user.click(within(lookup).getByRole('button', { name: 'Try again' }))
        expect(await screen.findByRole('list', { name: 'Lookup results' })).toBeInTheDocument()
    })
})

describe('Dashboard lookup history', () =>
{
    it('waits for a pick, then shows how the picked ticket moved', async () =>
    {
        const user = userEvent.setup()
        renderAs(ADMIN)
        await user.click(screen.getByRole('link', { name: 'History' }))
        const pending = screen.getByRole('region', { name: /^History/ })
        expect(pending).toHaveTextContent('Pick a ticket in the lookup results to see how it moved.')
        expect(getIncident).not.toHaveBeenCalled()
        await waitFor(() => expect(scrolled).toEqual(['dash-history']))

        const results = await screen.findByRole('list', { name: 'Lookup results' })
        const row = within(results).getByRole('button', { name: /INC-12 Kitchen tap leaking/ })
        expect(row).toHaveAttribute('aria-pressed', 'false')
        await user.click(row)
        expect(row).toHaveAttribute('aria-pressed', 'true')
        expect(getIncident).toHaveBeenCalledWith(12)

        expect(await screen.findByRole('heading', { name: 'INC-12 Kitchen tap leaking' })).toBeInTheDocument()
        const moves = screen.getByRole('list', { name: 'Status changes' })
        expect(within(moves).getAllByRole('listitem')).toHaveLength(2)
        expect(moves).toHaveTextContent('Assigned to Eli Engineer')
        expect(screen.getByRole('link', { name: 'Open the full ticket' })).toHaveAttribute('href', '/incidents/12')
        // side by side on a wide screen: the pick does not move the page; the one scroll was the nav jump
        expect(scrolled).toEqual(['dash-history'])
    })

    it('opens the history on a pick and scrolls to it on a phone', async () =>
    {
        globalThis.__screenWidth = 375
        const user = userEvent.setup()
        getIncident.mockRejectedValueOnce(new ApiError({ status: 404, code: 'not_found', message: 'gone' }))
        renderAs(ENGINEER)
        const results = await openLookup(user)
        expect(historyToggle()).toHaveAttribute('aria-expanded', 'false')
        await user.click(within(results).getByRole('button', { name: /INC-30/ }))
        expect(historyToggle()).toHaveAttribute('aria-expanded', 'true')
        expect(historyToggle()).toHaveTextContent('Showing INC-30')
        await waitFor(() => expect(scrolled).toContain('dash-history'))
        // the picked row keeps focus: the scroll is for the eye, not the keyboard
        expect(document.activeElement).toHaveAccessibleName(/INC-30/)

        const history = screen.getByRole('region', { name: /^History/ })
        expect(await within(history).findByRole('alert')).toHaveTextContent('That could not be found.')
        await user.click(within(history).getByRole('button', { name: 'Try again' }))
        expect(await screen.findByRole('link', { name: 'Open the full ticket' })).toBeInTheDocument()
    })
})
