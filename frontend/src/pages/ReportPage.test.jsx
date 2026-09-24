import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReportPage from './ReportPage.jsx'
import { ApiError } from '../services/http.js'
import { createIncident } from '../services/incidentService.js'
import { listBuildings, listFloors, listSeats } from '../services/facilityService.js'
import { renderPage } from '../test/render.jsx'

vi.mock('../services/incidentService.js', () => ({ createIncident: vi.fn() }))
vi.mock('../services/facilityService.js', () => ({
    listBuildings: vi.fn(),
    listFloors: vi.fn(),
    listSeats: vi.fn(),
}))

function page(items)
{
    return { items, total: items.length, page: 1, limit: 100 }
}

beforeEach(() =>
{
    listBuildings.mockResolvedValue(page([{ id: 1, name: 'Live HQ' }, { id: 2, name: 'Annex' }]))
    listFloors.mockImplementation(async (buildingId) => page(buildingId === 1 ? [{ id: 10, name: 'Floor 3' }] : []))
    listSeats.mockResolvedValue(page([{ id: 100, name: 'Seat 14' }]))
})

async function choose(user, label, option)
{
    await user.click(screen.getByRole('combobox', { name: label }))
    await user.click(await screen.findByRole('option', { name: option }))
}

async function fillRequired(user)
{
    await user.type(screen.getByRole('textbox', { name: /What is the problem/ }), 'Tap leaking')
    await user.type(screen.getByRole('textbox', { name: /Details/ }), 'Since Monday')
    await choose(user, /Kind of problem/, 'Plumbing')
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Building/ })).not.toHaveAttribute('aria-disabled'))
    await choose(user, /Building/, 'Live HQ')
}

describe('ReportPage', () =>
{
    it('cascades building, floor, and seat, and sends the report', async () =>
    {
        const user = userEvent.setup()
        let finish
        createIncident.mockImplementation(() => new Promise((resolve) =>
        {
            finish = resolve
        }))
        renderPage(<ReportPage />, { route: '/report' })

        const send = screen.getByRole('button', { name: 'Send report' })
        expect(send).toBeDisabled()
        await fillRequired(user)
        expect(send).toBeEnabled()

        await waitFor(() => expect(screen.getByRole('combobox', { name: /Floor/ })).not.toHaveAttribute('aria-disabled'))
        await choose(user, /Floor/, 'Floor 3')
        expect(listSeats).toHaveBeenCalledWith(10)
        await waitFor(() => expect(screen.getByRole('combobox', { name: /Seat/ })).not.toHaveAttribute('aria-disabled'))
        await choose(user, /Seat/, 'Seat 14')
        await choose(user, /How urgent/, 'High')
        expect(screen.getByText('Stops work for someone')).toBeInTheDocument()

        await user.click(send)
        expect(screen.getByRole('button', { name: 'Sending report' })).toBeDisabled()
        expect(createIncident).toHaveBeenCalledWith({
            title: 'Tap leaking',
            description: 'Since Monday',
            category: 'plumbing',
            priority: 'high',
            building_id: 1,
            floor_id: 10,
            seat_id: 100,
        })
        finish({ id: 77 })
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/incidents/77'))
    })

    it('sends null floor and seat for a building-wide problem, and says when a building has no floors', async () =>
    {
        const user = userEvent.setup()
        createIncident.mockResolvedValue({ id: 5 })
        renderPage(<ReportPage />)
        await user.type(screen.getByRole('textbox', { name: /What is the problem/ }), 'Lift broken')
        await user.type(screen.getByRole('textbox', { name: /Details/ }), 'Stuck')
        await choose(user, /Kind of problem/, 'Something else')
        await waitFor(() => expect(screen.getByRole('combobox', { name: /Building/ })).not.toHaveAttribute('aria-disabled'))
        await choose(user, /Building/, 'Annex')
        expect(await screen.findByText('This building has no floors listed.')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Send report' }))
        expect(createIncident).toHaveBeenCalledWith(expect.objectContaining({ building_id: 2, floor_id: null, seat_id: null }))
    })

    it('shows server field messages in place and re-enables the form', async () =>
    {
        const user = userEvent.setup()
        createIncident.mockRejectedValue(new ApiError({
            status: 400,
            code: 'validation_failed',
            message: 'invalid location',
            fields: { building_id: 'building 1 does not exist' },
        }))
        renderPage(<ReportPage />)
        await fillRequired(user)
        await user.click(screen.getByRole('button', { name: 'Send report' }))
        expect(await screen.findByText('Building 1 does not exist')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Send report' })).toBeEnabled()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('caps title and details at the server\'s lengths, counts the details, and places a control-character refusal', async () =>
    {
        const user = userEvent.setup()
        createIncident.mockRejectedValue(new ApiError({
            status: 400,
            code: 'validation_failed',
            message: 'invalid',
            fields: { title: 'must not contain control characters' },
        }))
        renderPage(<ReportPage />)
        const title = screen.getByLabelText(/What is the problem/)
        const details = screen.getByLabelText(/Details/)
        expect(title).toHaveAttribute('maxLength', '200')
        expect(details).toHaveAttribute('maxLength', '5000')
        expect(screen.getByText(/0\/5000/)).toBeInTheDocument()
        await fillRequired(user)
        expect(screen.getByText(new RegExp(`${details.value.length}/5000`))).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Send report' }))
        expect(await screen.findByText('Must not contain control characters')).toBeInTheDocument()
        expect(title).toHaveAttribute('aria-invalid', 'true')
    })

    it('shows an unexpected failure with its reference', async () =>
    {
        const user = userEvent.setup()
        createIncident.mockRejectedValue(new ApiError({ status: 500, code: 'internal', message: 'internal error', requestId: 'req-9' }))
        renderPage(<ReportPage />)
        await fillRequired(user)
        await user.click(screen.getByRole('button', { name: 'Send report' }))
        const alert = await screen.findByRole('alert')
        expect(within(alert).getByText('req-9')).toBeInTheDocument()
    })

    it('says when places cannot be loaded', async () =>
    {
        listBuildings.mockRejectedValue(new ApiError({ status: 0, code: 'network', message: 'x' }))
        renderPage(<ReportPage />)
        expect(await screen.findByText(/Could not load places/)).toBeInTheDocument()
    })
})
