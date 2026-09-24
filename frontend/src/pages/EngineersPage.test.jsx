import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EngineersPage from './EngineersPage.jsx'
import { ApiError } from '../services/http.js'
import { listEngineersByWorkload, setAvailability } from '../services/engineerService.js'
import { searchPromotable, setRoles } from '../services/userService.js'
import { ADMIN, fakeAuth, renderPage } from '../test/render.jsx'

vi.mock('../services/engineerService.js', () => ({ listEngineersByWorkload: vi.fn(), setAvailability: vi.fn() }))
vi.mock('../services/userService.js', () => ({ searchPromotable: vi.fn(), setRoles: vi.fn() }))

const ENGINEERS = [
    { id: 7, email: 'sofia@acme.inc', full_name: 'Sofia Alvarez', is_available: true, workload: 0 },
    { id: 6, email: 'marcus@acme.inc', full_name: 'Marcus Webb', is_available: true, workload: 1, roles: ['employee', 'engineer'] },
    { id: 5, email: 'priya@acme.inc', full_name: 'Priya Nair', is_available: false, workload: 3, roles: ['employee', 'engineer', 'admin'] },
]

function page(items)
{
    return { items, total: items.length, page: 1, limit: 100 }
}

function renderAs(user)
{
    return renderPage(<EngineersPage />, { route: '/engineers', auth: fakeAuth({ user }) })
}

function section()
{
    return screen.findByRole('region', { name: "Who's available" })
}

beforeEach(() =>
{
    listEngineersByWorkload.mockResolvedValue(page(ENGINEERS))
    searchPromotable.mockResolvedValue(page([]))
    setAvailability.mockResolvedValue({})
})

describe("Who's available", () =>
{
    it('shows an admin every engineer, least loaded first, with availability and workload', async () =>
    {
        renderAs(ADMIN)
        const team = await section()
        const table = await within(team).findByRole('table', { name: 'Engineers' })
        const rows = within(table).getAllByRole('row').slice(1)
        expect(rows.map((row) => within(within(row).getAllByRole('cell')[0]).getByRole('link').textContent)).toEqual(['Sofia Alvarez', 'Marcus Webb', 'Priya Nair'])
        expect(rows[2]).toHaveTextContent('priya@acme.inc')
        expect(rows[2]).toHaveTextContent('Not taking new work')
        expect(rows[2]).toHaveTextContent('3')
        expect(within(rows[0]).getByRole('switch', { name: 'Sofia Alvarez takes new tickets' })).toBeChecked()
        expect(team).toHaveTextContent('2 of 3 engineers are taking new work.')
        expect(team).toHaveTextContent("Engineers marked unavailable can't be assigned new tickets. Tickets they already hold stay with them.")
        // each name opens the read-only view of that engineer's work
        expect(within(rows[2]).getByRole('link', { name: 'Priya Nair' })).toHaveAttribute('href', '/engineers/5')
    })

    it('sets availability and re-reads the table', async () =>
    {
        const user = userEvent.setup()
        renderAs(ADMIN)
        const team = await section()
        await user.click(await within(team).findByRole('switch', { name: 'Marcus Webb takes new tickets' }))
        expect(setAvailability).toHaveBeenCalledWith(6, false)
        await waitFor(() => expect(listEngineersByWorkload).toHaveBeenCalledTimes(2))
        await user.click(within(team).getByRole('switch', { name: 'Priya Nair takes new tickets' }))
        expect(setAvailability).toHaveBeenLastCalledWith(5, true)
    })

    it('says why a change failed, with the reference', async () =>
    {
        const user = userEvent.setup()
        setAvailability.mockRejectedValue(new ApiError({ status: 500, code: 'internal', message: 'boom', requestId: 'req-3' }))
        renderAs(ADMIN)
        const team = await section()
        await user.click(await within(team).findByRole('switch', { name: 'Marcus Webb takes new tickets' }))
        expect(await within(team).findByRole('alert')).toHaveTextContent('Quote reference req-3')
    })

    it('finds an employee by search and makes them an engineer', async () =>
    {
        const user = userEvent.setup()
        // the server leaves engineers out (lacks=engineer); an admin who is not an engineer is a candidate
        searchPromotable.mockImplementation(async (q) => page(q === 'ali'
            ? [{ id: 9, email: 'ali@acme.inc', full_name: 'Ali Khan', role: 'admin', roles: ['employee', 'admin'] }]
            : []))
        setRoles.mockResolvedValue({ user: { id: 9, role: 'admin', roles: ['employee', 'engineer', 'admin'] }, unassigned_incidents: [] })
        renderAs(ADMIN)
        const team = await section()
        const promote = within(team).getByRole('button', { name: 'Make engineer' })
        expect(promote).toBeDisabled()

        await user.type(within(team).getByRole('combobox', { name: 'Find an employee' }), 'ali')
        await waitFor(() => expect(searchPromotable).toHaveBeenLastCalledWith('ali'))
        await user.click(await screen.findByRole('option', { name: 'Ali Khan (ali@acme.inc)' }))
        await user.click(promote)

        // the whole set: what they held, plus engineer; an admin stays an admin
        expect(setRoles).toHaveBeenCalledWith(9, ['employee', 'engineer', 'admin'])
        expect(await within(team).findByText('Ali Khan is now an engineer and can be assigned tickets.')).toBeInTheDocument()
        await waitFor(() => expect(listEngineersByWorkload).toHaveBeenCalledTimes(2))
        expect(within(team).getByRole('combobox', { name: 'Find an employee' })).toHaveValue('')
    })

    it('keeps the pick when a promotion fails', async () =>
    {
        const user = userEvent.setup()
        // a user from before roles existed: the active role stands in for the set
        searchPromotable.mockResolvedValue(page([{ id: 9, email: 'ali@acme.inc', full_name: 'Ali Khan', role: 'employee' }]))
        setRoles.mockRejectedValue(new ApiError({ status: 409, code: 'conflict', message: 'That user is no longer an employee.' }))
        renderAs(ADMIN)
        const team = await section()
        await user.click(within(team).getByRole('combobox', { name: 'Find an employee' }))
        await user.click(await screen.findByRole('option', { name: /Ali Khan/ }))
        await user.click(within(team).getByRole('button', { name: 'Make engineer' }))
        expect(await within(team).findByRole('alert')).toHaveTextContent('That user is no longer an employee.')
        expect(within(team).getByRole('combobox', { name: 'Find an employee' })).toHaveValue('Ali Khan (ali@acme.inc)')
        expect(setRoles).toHaveBeenCalledWith(9, ['employee', 'engineer'])
    })

    it('asks before demoting, states what happens to the tickets, and sends nothing on cancel', async () =>
    {
        const user = userEvent.setup()
        renderAs(ADMIN)
        const team = await section()
        await user.click(await within(team).findByRole('button', { name: 'Demote Priya Nair' }))
        const dialog = await screen.findByRole('dialog', { name: 'Demote Priya Nair to employee?' })
        expect(dialog).toHaveTextContent('Their 3 active tickets will go back to Unassigned for reassignment.')
        const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
        expect(cancel).toHaveFocus()
        await user.click(cancel)
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(setRoles).not.toHaveBeenCalled()

        await user.click(within(team).getByRole('button', { name: 'Demote Marcus Webb' }))
        expect(await screen.findByRole('dialog')).toHaveTextContent('Their 1 active ticket will go back to Unassigned for reassignment.')
    })

    it('demotes on confirm, lists the tickets sent back to triage, and re-reads the list', async () =>
    {
        const user = userEvent.setup()
        setRoles.mockResolvedValue({ user: { id: 5, role: 'admin', roles: ['employee', 'admin'] }, unassigned_incidents: [12, 40] })
        renderAs(ADMIN)
        const team = await section()
        await user.click(await within(team).findByRole('button', { name: 'Demote Priya Nair' }))
        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Demote' }))

        // the set she holds, minus engineer: her admin role is kept
        expect(setRoles).toHaveBeenCalledWith(5, ['employee', 'admin'])
        expect(await within(team).findByText('Priya Nair is no longer an engineer. Returned to triage: INC-12, INC-40.')).toBeInTheDocument()
        await waitFor(() => expect(listEngineersByWorkload).toHaveBeenCalledTimes(2))
    })

    it('says nothing is reassigned for an engineer with no tickets', async () =>
    {
        const user = userEvent.setup()
        listEngineersByWorkload.mockResolvedValue(page([{ ...ENGINEERS[0], roles: ['employee', 'engineer'] }, ...ENGINEERS.slice(1)]))
        setRoles.mockResolvedValue({ user: { id: 7, role: 'employee', roles: ['employee'] }, unassigned_incidents: [] })
        renderAs(ADMIN)
        const team = await section()
        await user.click(await within(team).findByRole('button', { name: 'Demote Sofia Alvarez' }))
        const dialog = await screen.findByRole('dialog')
        expect(dialog).toHaveTextContent('They have no active tickets, so nothing is reassigned.')
        await user.click(within(dialog).getByRole('button', { name: 'Demote' }))
        expect(await within(team).findByText('Sofia Alvarez is no longer an engineer. No tickets needed reassigning.')).toBeInTheDocument()
        expect(setRoles).toHaveBeenCalledWith(7, ['employee'])
    })

    it('keeps the dialog open with the reason when a demotion fails', async () =>
    {
        const user = userEvent.setup()
        setRoles.mockRejectedValue(new ApiError({ status: 500, code: 'internal', message: 'boom', requestId: 'req-8' }))
        renderAs(ADMIN)
        const team = await section()
        await user.click(await within(team).findByRole('button', { name: 'Demote Priya Nair' }))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: 'Demote' }))
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Quote reference req-8')
        expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('sends nothing when a row does not say which roles are held, rather than guess them', async () =>
    {
        const user = userEvent.setup()
        renderAs(ADMIN)
        const team = await section()
        await user.click(await within(team).findByRole('button', { name: 'Demote Sofia Alvarez' }))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: 'Demote' }))
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('did not say which roles this person holds')
        expect(setRoles).not.toHaveBeenCalled()
    })

    it('shows roles beyond engineer as tags', async () =>
    {
        renderAs(ADMIN)
        const table = await within(await section()).findByRole('table', { name: 'Engineers' })
        const priya = within(table).getAllByRole('row').find((row) => row.textContent.includes('Priya Nair'))
        expect(priya).toHaveTextContent('Facility admin')
        const marcus = within(table).getAllByRole('row').find((row) => row.textContent.includes('Marcus Webb'))
        expect(marcus).not.toHaveTextContent('Facility admin')
    })

    it('says when there are no engineers yet', async () =>
    {
        listEngineersByWorkload.mockResolvedValue(page([]))
        renderAs(ADMIN)
        const team = await section()
        expect(screen.getByRole('heading', { name: 'Engineers', level: 1 })).toBeInTheDocument()
        expect(await within(team).findByText('No engineers yet. Find an employee above to make the first one.')).toBeInTheDocument()
    })

    it('uses one card per engineer on a phone', async () =>
    {
        globalThis.__screenWidth = 375
        renderAs(ADMIN)
        const team = await section()
        const list = await within(team).findByRole('list', { name: 'Engineers' })
        expect(within(list).getAllByRole('listitem')).toHaveLength(3)
        expect(within(list).getByRole('button', { name: 'Demote Priya Nair' })).toBeInTheDocument()
        expect(within(list).getByRole('link', { name: 'Priya Nair' })).toHaveAttribute('href', '/engineers/5')
    })
})
