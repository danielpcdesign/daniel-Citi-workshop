import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MyTicketsPage, { TICKETS_POLL_MS } from './MyTicketsPage.jsx'
import { ApiError } from '../services/http.js'
import { listIncidents } from '../services/incidentService.js'
import { EMPLOYEE, incidentFixture, renderPage } from '../test/render.jsx'

vi.mock('../services/incidentService.js', () => ({ listIncidents: vi.fn() }))

const ACTIVE = ['unassigned', 'open', 'in_progress', 'blocked', 'resolved']

beforeEach(() =>
{
    listIncidents.mockResolvedValue({
        items: [
            incidentFixture(),
            incidentFixture({ id: 13, title: 'Door stuck', status: 'blocked', assignee_name: 'Eli Engineer', location: { building: { id: 1, name: 'Old wing', archived: true }, floor: null, seat: null } }),
        ],
        total: 45,
        page: 1,
        limit: 20,
    })
})

afterEach(() =>
{
    vi.useRealTimers()
})

describe('MyTicketsPage', () =>
{
    it('lists my reports, latest activity first, with a plain next step', async () =>
    {
        renderPage(<MyTicketsPage />, { route: '/tickets' })
        expect(screen.getByRole('status')).toHaveTextContent('Loading your tickets')
        const list = await screen.findByRole('list', { name: 'Tickets' })
        expect(listIncidents).toHaveBeenCalledWith({ reporter_id: EMPLOYEE.id, status: ACTIVE, sort: '-updated_at', page: 1, limit: 20 })
        const rows = within(list).getAllByRole('listitem')
        expect(rows).toHaveLength(2)
        expect(rows[0]).toHaveTextContent('INC-12')
        expect(rows[0]).toHaveTextContent('Waiting for a facility admin to pick an engineer.')
        expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/incidents/12')
        expect(rows[1]).toHaveTextContent('Old wing (archived)')
        expect(within(rows[1]).getByRole('img')).toHaveAccessibleName('Status: Blocked, step 3 of 5')
        expect(screen.getByText('45 tickets')).toBeInTheDocument()
    })

    it('filters and pages on the server', async () =>
    {
        const user = userEvent.setup()
        renderPage(<MyTicketsPage />, { route: '/tickets' })
        await screen.findByRole('list', { name: 'Tickets' })

        await user.click(screen.getByRole('button', { name: 'Closed' }))
        await waitFor(() => expect(listIncidents).toHaveBeenLastCalledWith(expect.objectContaining({ status: ['closed'], page: 1 })))
        expect(screen.getByTestId('location')).toHaveTextContent('view=closed')

        await user.click(screen.getByRole('button', { name: 'Go to page 2' }))
        await waitFor(() => expect(listIncidents).toHaveBeenLastCalledWith(expect.objectContaining({ status: ['closed'], page: 2 })))

        await user.click(screen.getByRole('button', { name: 'All' }))
        await waitFor(() => expect(listIncidents).toHaveBeenLastCalledWith(expect.objectContaining({ status: [], page: 1 })))
        // pressing the selected view again changes nothing
        await user.click(screen.getByRole('button', { name: 'All' }))
        expect(screen.getByTestId('location')).toHaveTextContent('view=all')
    })

    it('invites a first report when there is nothing to show', async () =>
    {
        listIncidents.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 })
        renderPage(<MyTicketsPage />, { route: '/tickets?view=closed' })
        expect(await screen.findByText('No closed tickets yet')).toBeInTheDocument()
        expect(screen.getAllByRole('link', { name: 'Report a problem' })).toHaveLength(2)
    })

    it('shows a failure with a retry', async () =>
    {
        const user = userEvent.setup()
        listIncidents.mockRejectedValueOnce(new ApiError({ status: 0, code: 'network', message: 'x' }))
        renderPage(<MyTicketsPage />)
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
        await user.click(screen.getByRole('button', { name: 'Try again' }))
        expect(await screen.findByRole('list', { name: 'Tickets' })).toBeInTheDocument()
    })

    it('refreshes every 60 seconds', async () =>
    {
        vi.useFakeTimers()
        renderPage(<MyTicketsPage />)
        await act(async () => undefined)
        expect(listIncidents).toHaveBeenCalledTimes(1)
        expect(TICKETS_POLL_MS).toBe(60000)
        await act(async () => vi.advanceTimersByTime(TICKETS_POLL_MS))
        expect(listIncidents).toHaveBeenCalledTimes(2)
    })
})
