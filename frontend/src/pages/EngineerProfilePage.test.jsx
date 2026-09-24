import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EngineerProfilePage from './EngineerProfilePage.jsx'
import { ApiError } from '../services/http.js'
import { getEngineer, setAvailability } from '../services/engineerService.js'
import { listIncidents } from '../services/incidentService.js'
import { ADMIN, fakeAuth, incidentFixture, renderPage } from '../test/render.jsx'

vi.mock('../services/engineerService.js', () => ({ getEngineer: vi.fn(), setAvailability: vi.fn() }))
vi.mock('../services/incidentService.js', () => ({ listIncidents: vi.fn() }))

const MARCUS = { id: 6, email: 'marcus@acme.inc', full_name: 'Marcus Webb', is_available: true, workload: 4 }
// per status: [items shown, server total]
const COLUMNS = {
    open: [[incidentFixture({ id: 21, title: 'Door sensor dead', status: 'open', assignee_name: 'Marcus Webb' })], 1],
    in_progress: [[incidentFixture({ id: 22, title: 'Radiator cold', status: 'in_progress' })], 2],
    blocked: [[incidentFixture({ id: 23, title: 'Lift stuck', status: 'blocked' })], 1],
    resolved: [[], 3],
    closed: [[], 12],
}
const REPORTED = [incidentFixture({ id: 40, title: 'Printer jams', reporter_name: 'Marcus Webb' })]

// the board comes from getBoard, so the list is answered per status; the reported list has reporter_id instead
function answer(filters)
{
    if (filters.reporter_id)
    {
        return { items: REPORTED, total: 7, page: 1, limit: 5 }
    }
    const [items, total] = COLUMNS[filters.status[0]]
    return { items, total, page: 1, limit: 6 }
}

function renderProfile(id = '6')
{
    return renderPage(<EngineerProfilePage />, { route: `/engineers/${id}`, path: '/engineers/:id', auth: fakeAuth({ user: ADMIN }) })
}

beforeEach(() =>
{
    getEngineer.mockResolvedValue(MARCUS)
    listIncidents.mockImplementation(async (filters) => answer(filters))
    setAvailability.mockResolvedValue({})
})

describe('EngineerProfilePage', () =>
{
    it('says whose work is shown, read-only, with the assigned-versus-reported caveat and a way back', async () =>
    {
        renderProfile()
        const banner = await screen.findByRole('note')
        expect(banner).toHaveTextContent("Viewing Marcus Webb's work (read-only)")
        expect(banner).toHaveTextContent('Shows tickets assigned to them; tickets they reported are listed separately.')
        expect(within(banner).getByRole('link', { name: 'Back to engineers' })).toHaveAttribute('href', '/engineers')
        expect(screen.getByRole('heading', { name: 'Marcus Webb', level: 1 })).toBeInTheDocument()
        expect(screen.getByText('marcus@acme.inc')).toBeInTheDocument()
        expect(screen.getByText('4 active tickets')).toBeInTheDocument()
        expect(getEngineer).toHaveBeenCalledWith('6')
    })

    it('asks for their assigned tickets one status at a time, and what they reported, newest first', async () =>
    {
        renderProfile()
        await screen.findByRole('note')
        await waitFor(() => expect(listIncidents).toHaveBeenCalledTimes(6))
        const filters = listIncidents.mock.calls.map(([query]) => query)
        const board = filters.filter((query) => query.assignee_id)
        // an assigned ticket is never unassigned: no request for that column
        expect(board.map((query) => query.status[0])).toEqual(['open', 'in_progress', 'blocked', 'resolved', 'closed'])
        expect(board.every((query) => query.assignee_id === '6' && query.limit === 6)).toBe(true)
        expect(filters).toContainEqual({ reporter_id: '6', sort: '-created_at', limit: 5 })
        // one refresh, one correlation id across the board's requests (AD-16)
        const boardIds = listIncidents.mock.calls.filter(([query]) => query.assignee_id).map(([, options]) => options.correlationId)
        expect(new Set(boardIds).size).toBe(1)
    })

    it('counts from the board column totals, not the items shown', async () =>
    {
        renderProfile()
        const counts = await screen.findByLabelText('Their tickets in numbers')
        const figure = (label) => within(counts).getByText(label).closest('div')
        // open 1 + in progress 2 + blocked 1
        expect(figure('Active')).toHaveTextContent('4')
        expect(figure('Blocked')).toHaveTextContent('1')
        expect(figure('Fixed, waiting to close')).toHaveTextContent('3')
        expect(figure('Closed')).toHaveTextContent('12')

        const board = screen.getByRole('region', { name: 'Their tickets by status' })
        expect(within(board).getByRole('link', { name: /Door sensor dead/ })).toHaveAttribute('href', '/incidents/21')
        expect(within(board).getByRole('region', { name: 'Closed' })).toHaveTextContent('12 tickets')
        expect(within(board).queryByRole('region', { name: 'Unassigned' })).not.toBeInTheDocument()
    })

    it('lists the latest tickets they reported, with how many there are', async () =>
    {
        renderProfile()
        const section = await screen.findByRole('region', { name: 'Reported by them' })
        const list = await within(section).findByRole('list', { name: 'Tickets they reported' })
        expect(within(list).getByRole('link', { name: /Printer jams/ })).toHaveAttribute('href', '/incidents/40')
        expect(section).toHaveTextContent('Latest 1 of 7.')
    })

    it('says so when nothing is assigned to or reported by them', async () =>
    {
        listIncidents.mockResolvedValue({ items: [], total: 0, page: 1, limit: 6 })
        renderProfile()
        expect(await screen.findByText('No tickets are assigned to them.')).toBeInTheDocument()
        expect(screen.getByText('They have not reported any tickets.')).toBeInTheDocument()
    })

    it('shows a short list in full', async () =>
    {
        listIncidents.mockImplementation(async (filters) => (filters.reporter_id ? { items: REPORTED, total: 1, page: 1, limit: 5 } : answer(filters)))
        renderProfile()
        expect(await screen.findByText('1 in total.')).toBeInTheDocument()
    })

    it('toggles availability and re-reads the profile', async () =>
    {
        const user = userEvent.setup()
        renderProfile()
        await user.click(await screen.findByRole('switch', { name: 'Marcus Webb takes new tickets' }))
        expect(setAvailability).toHaveBeenCalledWith(6, false)
        await waitFor(() => expect(getEngineer).toHaveBeenCalledTimes(2))
    })

    it('shows a failed availability change', async () =>
    {
        const user = userEvent.setup()
        setAvailability.mockRejectedValue(new ApiError({ status: 500, code: 'internal', message: 'boom', requestId: 'req-5' }))
        renderProfile()
        await user.click(await screen.findByRole('switch', { name: 'Marcus Webb takes new tickets' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Quote reference req-5')
    })

    it('says there is no such engineer for an unknown or non-engineer id', async () =>
    {
        getEngineer.mockRejectedValue(new ApiError({ status: 404, code: 'not_found', message: 'engineer not found' }))
        renderProfile('41')
        expect(await screen.findByRole('heading', { name: 'No engineer with that id' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Back to engineers' })).toHaveAttribute('href', '/engineers')
        expect(screen.queryByRole('note')).not.toBeInTheDocument()
    })

    it('does not ask the server about an id that is not a number', () =>
    {
        renderProfile('abc')
        expect(screen.getByRole('heading', { name: 'No engineer with that id' })).toBeInTheDocument()
        expect(getEngineer).not.toHaveBeenCalled()
        expect(listIncidents).not.toHaveBeenCalled()
    })

    it('shows an unexpected failure with its reference and a retry', async () =>
    {
        const user = userEvent.setup()
        getEngineer.mockRejectedValueOnce(new ApiError({ status: 500, code: 'internal', message: 'boom', requestId: 'req-6' }))
        renderProfile()
        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent('Quote reference req-6')
        await user.click(within(alert).getByRole('button', { name: 'Try again' }))
        expect(await screen.findByRole('note')).toHaveTextContent('Marcus Webb')
    })
})
