import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IncidentPage, { DETAIL_POLL_MS } from './IncidentPage.jsx'
import { ApiError } from '../services/http.js'
import { getIncident, transitionIncident } from '../services/incidentService.js'
import { listNotes } from '../services/noteService.js'
import { ENGINEER, fakeAuth, incidentFixture, renderPage } from '../test/render.jsx'

vi.mock('../services/incidentService.js', () => ({
    getIncident: vi.fn(),
    transitionIncident: vi.fn(),
    assignIncident: vi.fn(),
    requestEscalation: vi.fn(),
    decideEscalation: vi.fn(),
}))
vi.mock('../services/noteService.js', () => ({
    listNotes: vi.fn(),
    addNote: vi.fn(),
    editNote: vi.fn(),
    deleteNote: vi.fn(),
}))

const H = (from, to, at, reason = null) => ({ from, to, at, actor_id: 1, actor_name: 'Someone', assignee_id: null, assignee_name: null, reason })

const BLOCKED = incidentFixture({
    status: 'blocked',
    assignee_id: ENGINEER.id,
    assignee_name: 'Eli Engineer',
    priority: 'high',
    requested_priority: 'medium',
    escalation_status: 'pending',
    location: {
        building: { id: 1, name: 'Old wing', archived: true },
        floor: { id: 2, name: 'Floor 1', archived: true },
        seat: null,
    },
    history: [
        H(null, 'unassigned', '2026-09-20T09:00:00+00:00'),
        H('unassigned', 'open', '2026-09-20T10:00:00+00:00'),
        H('open', 'in_progress', '2026-09-20T11:00:00+00:00'),
        H('in_progress', 'blocked', '2026-09-20T12:00:00+00:00', 'Waiting for a new valve'),
    ],
    actions: { edit: [], delete: false, assign: false, transitions: ['in_progress'], request_escalation: false, set_escalation: false },
})

function renderDetail(options = {})
{
    return renderPage(<IncidentPage />, { route: '/incidents/12', path: '/incidents/:id', ...options })
}

beforeEach(() =>
{
    listNotes.mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 })
})

afterEach(() =>
{
    vi.useRealTimers()
})

describe('IncidentPage', () =>
{
    it('shows the plate, the stepper with blocked as an error, and what happens next', async () =>
    {
        getIncident.mockResolvedValue(BLOCKED)
        renderDetail({ auth: fakeAuth({ user: ENGINEER }) })
        expect(screen.getByRole('status')).toHaveTextContent('Loading the ticket')
        expect(await screen.findByText('INC-12')).toBeInTheDocument()
        expect(getIncident).toHaveBeenCalledWith('12')
        expect(screen.getByRole('heading', { level: 1, name: 'Kitchen tap leaking' })).toBeInTheDocument()
        expect(screen.getByText('Old wing (archived), Floor 1 (archived)')).toBeInTheDocument()
        expect(screen.getByText(/has since been removed/)).toBeInTheDocument()
        expect(screen.getByText('High (asked for Medium)')).toBeInTheDocument()
        expect(screen.getByText('Escalation requested')).toBeInTheDocument()

        const progress = screen.getByRole('region', { name: 'Progress' })
        expect(within(progress).getByText('Waiting for a new valve')).toBeInTheDocument()
        expect(within(progress).getByText(/^Blocked since/)).toBeInTheDocument()
        // steps after the current one carry no time
        expect(within(progress).getAllByText(/2026/)).toHaveLength(3)

        expect(screen.getByText(/Eli Engineer is waiting on something/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Resume work' })).toBeInTheDocument()
    })

    it('shows the history beside the notes, newest first, and refreshes it with the detail poll', async () =>
    {
        vi.useFakeTimers()
        getIncident.mockResolvedValueOnce(incidentFixture()).mockResolvedValueOnce(BLOCKED)
        renderDetail()
        await act(async () => undefined)
        const history = screen.getByRole('region', { name: 'History' })
        expect(within(history).getAllByRole('listitem')).toHaveLength(1)
        expect(within(history).getByText('Reported')).toBeInTheDocument()

        await act(async () => vi.advanceTimersByTime(DETAIL_POLL_MS))
        const moves = within(screen.getByRole('region', { name: 'History' })).getAllByRole('listitem')
        expect(moves).toHaveLength(4)
        expect(moves[0]).toHaveTextContent('In progress→ to Blocked')
        expect(within(moves[0]).getByText('Waiting for a new valve')).toBeInTheDocument()
    })

    it('leaves the history out when there is none', async () =>
    {
        getIncident.mockResolvedValue(incidentFixture({ history: [] }))
        renderDetail()
        await screen.findByText('INC-12')
        expect(screen.queryByRole('region', { name: 'History' })).not.toBeInTheDocument()
        expect(screen.getByRole('region', { name: 'Conversation' })).toBeInTheDocument()
    })

    it('marks every step done on a closed ticket', async () =>
    {
        getIncident.mockResolvedValue(incidentFixture({
            status: 'closed',
            history: [H(null, 'unassigned', '2026-09-20T09:00:00+00:00'), H('resolved', 'closed', '2026-09-22T09:00:00+00:00')],
        }))
        renderDetail()
        await screen.findByText('INC-12')
        expect(screen.getByText('Done. This ticket is closed.')).toBeInTheDocument()
        expect(screen.getByText('This ticket is closed, so the conversation is read-only.')).toBeInTheDocument()
    })

    it('confirms a fresh report', async () =>
    {
        getIncident.mockResolvedValue(incidentFixture())
        renderDetail({ state: { justReported: true } })
        expect(await screen.findByText(/Your report was sent/)).toBeInTheDocument()
        expect(screen.getByText('Not assigned yet')).toBeInTheDocument()
    })

    it('explains a ticket that cannot be seen', async () =>
    {
        getIncident.mockRejectedValue(new ApiError({ status: 404, code: 'not_found', message: 'incident not found' }))
        renderDetail()
        expect(await screen.findByRole('alert')).toHaveTextContent('That could not be found')
        expect(screen.getByRole('link', { name: 'Back to my tickets' })).toBeInTheDocument()
    })

    it('refetches the ticket and the conversation right after an action', async () =>
    {
        const user = userEvent.setup()
        getIncident.mockResolvedValue(BLOCKED)
        transitionIncident.mockResolvedValue({ ...BLOCKED, status: 'in_progress' })
        renderDetail({ auth: fakeAuth({ user: ENGINEER }) })
        await user.click(await screen.findByRole('button', { name: 'Resume work' }))
        expect(transitionIncident).toHaveBeenCalledWith(12, 'in_progress')
        await vi.waitFor(() => expect(getIncident).toHaveBeenCalledTimes(2))
        await vi.waitFor(() => expect(listNotes).toHaveBeenCalledTimes(2))
    })

    it('keeps the ticket on screen when a refresh fails, and polls every 20 seconds', async () =>
    {
        vi.useFakeTimers()
        getIncident.mockResolvedValueOnce(BLOCKED).mockRejectedValueOnce(new ApiError({ status: 0, code: 'network', message: 'x' }))
        renderDetail()
        await act(async () => undefined)
        expect(screen.getByText('INC-12')).toBeInTheDocument()
        expect(DETAIL_POLL_MS).toBe(20000)
        await act(async () => vi.advanceTimersByTime(DETAIL_POLL_MS))
        expect(getIncident).toHaveBeenCalledTimes(2)
        expect(screen.getByText('INC-12')).toBeInTheDocument()
        expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Could not reach the server')
    })
})
