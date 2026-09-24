import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FacilitiesPage from './FacilitiesPage.jsx'
import { ApiError } from '../services/http.js'
import { archivePlace, createPlace, listBuildings, listFloors, listSeats, renamePlace } from '../services/facilityService.js'
import { ADMIN, fakeAuth, renderPage } from '../test/render.jsx'

vi.mock('../services/facilityService.js', () => ({
    listBuildings: vi.fn(),
    listFloors: vi.fn(),
    listSeats: vi.fn(),
    createPlace: vi.fn(),
    renamePlace: vi.fn(),
    archivePlace: vi.fn(),
}))

function page(items, total = items.length)
{
    return { items, total, page: 1, limit: 100 }
}

const HQ = { id: 1, name: 'Live HQ', created_at: '2026-09-20T09:00:00+00:00' }
const ANNEX = { id: 2, name: 'Riverside Annex', created_at: '2026-09-20T09:00:00+00:00' }
const FLOOR = { id: 5, name: 'Floor 2', building_id: 1 }
const SEAT = { id: 9, name: '2-07', floor_id: 5 }

function renderFacilities()
{
    return renderPage(<FacilitiesPage />, { route: '/facilities', auth: fakeAuth({ user: ADMIN }) })
}

beforeEach(() =>
{
    listBuildings.mockResolvedValue(page([HQ, ANNEX]))
    listFloors.mockResolvedValue(page([FLOOR]))
    listSeats.mockResolvedValue(page([SEAT]))
    createPlace.mockResolvedValue({})
    renamePlace.mockResolvedValue({})
    archivePlace.mockResolvedValue(null)
})

describe('FacilitiesPage', () =>
{
    it('lists buildings, and loads floors then seats only when opened', async () =>
    {
        const user = userEvent.setup()
        renderFacilities()
        const buildings = await screen.findByRole('list', { name: 'Buildings' })
        expect(within(buildings).getByText('Live HQ')).toBeInTheDocument()
        expect(listFloors).not.toHaveBeenCalled()

        const open = screen.getByRole('button', { name: 'Show floors in Live HQ' })
        expect(open).toHaveAttribute('aria-expanded', 'false')
        await user.click(open)
        expect(screen.getByRole('button', { name: 'Hide floors in Live HQ' })).toHaveAttribute('aria-expanded', 'true')
        expect(listFloors).toHaveBeenCalledWith(1)
        const floors = await screen.findByRole('list', { name: 'Floors of Live HQ' })
        expect(floors).toHaveTextContent('Floor 2')

        await user.click(screen.getByRole('button', { name: 'Show seats in Floor 2' }))
        expect(listSeats).toHaveBeenCalledWith(5)
        const seats = await screen.findByRole('list', { name: 'Seats of Floor 2' })
        expect(seats).toHaveTextContent('2-07')
        // seats are the bottom of the tree: nothing to open
        expect(within(seats).queryByRole('button', { name: /^Show/ })).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Hide floors in Live HQ' }))
        expect(screen.queryByRole('list', { name: 'Floors of Live HQ' })).not.toBeInTheDocument()
    })

    it('invites the first building when there are none', async () =>
    {
        listBuildings.mockResolvedValue(page([]))
        renderFacilities()
        expect(await screen.findByText('No buildings yet — add the first one.')).toBeInTheDocument()
    })

    it('says when a floor has nothing under it', async () =>
    {
        const user = userEvent.setup()
        listFloors.mockResolvedValue(page([]))
        renderFacilities()
        await user.click(await screen.findByRole('button', { name: 'Show floors in Live HQ' }))
        expect(await screen.findByText('No floors yet.')).toBeInTheDocument()
    })

    it('adds a building, clears the box, and re-reads the list', async () =>
    {
        const user = userEvent.setup()
        renderFacilities()
        await screen.findByRole('list', { name: 'Buildings' })
        const box = screen.getByRole('textbox', { name: 'New building' })
        expect(screen.getByRole('button', { name: 'Add building' })).toBeDisabled()
        await user.type(box, '  Zz Test Building ')
        await user.click(screen.getByRole('button', { name: 'Add building' }))
        expect(createPlace).toHaveBeenCalledWith('building', null, 'Zz Test Building')
        await waitFor(() => expect(box).toHaveValue(''))
        expect(listBuildings).toHaveBeenCalledTimes(2)
    })

    it('shows a duplicate name beside the box, and keeps what was typed', async () =>
    {
        const user = userEvent.setup()
        createPlace.mockRejectedValue(new ApiError({ status: 409, code: 'conflict', message: "a building named 'Live HQ' already exists" }))
        renderFacilities()
        await screen.findByRole('list', { name: 'Buildings' })
        const box = screen.getByRole('textbox', { name: 'New building' })
        await user.type(box, 'Live HQ')
        await user.click(screen.getByRole('button', { name: 'Add building' }))
        expect(await screen.findByText("A building named 'Live HQ' already exists")).toBeInTheDocument()
        expect(box).toHaveAttribute('aria-invalid', 'true')
        expect(box).toHaveValue('Live HQ')
    })

    it('shows the server\'s field message beside the box, and other failures below it', async () =>
    {
        const user = userEvent.setup()
        createPlace.mockRejectedValueOnce(new ApiError({ status: 400, code: 'validation_failed', message: 'invalid', fields: { name: 'Value error, must not be empty' } }))
        createPlace.mockRejectedValueOnce(new ApiError({ status: 500, code: 'internal', message: 'boom', requestId: 'req-2' }))
        renderFacilities()
        await screen.findByRole('list', { name: 'Buildings' })
        await user.type(screen.getByRole('textbox', { name: 'New building' }), 'x')
        await user.click(screen.getByRole('button', { name: 'Add building' }))
        expect(await screen.findByText('Must not be empty')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Add building' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Quote reference req-2')
        expect(screen.queryByText('Must not be empty')).not.toBeInTheDocument()
    })

    it('adds a floor to a building and a seat to a floor', async () =>
    {
        const user = userEvent.setup()
        renderFacilities()
        await user.click(await screen.findByRole('button', { name: 'Show floors in Live HQ' }))
        await user.type(await screen.findByRole('textbox', { name: 'New floor in Live HQ' }), 'Floor 3')
        await user.click(screen.getByRole('button', { name: 'Add floor' }))
        expect(createPlace).toHaveBeenCalledWith('floor', 1, 'Floor 3')
        await waitFor(() => expect(listFloors).toHaveBeenCalledTimes(2))

        await user.click(await screen.findByRole('button', { name: 'Show seats in Floor 2' }))
        await user.type(await screen.findByRole('textbox', { name: 'New seat in Floor 2' }), '2-08')
        await user.click(screen.getByRole('button', { name: 'Add seat' }))
        expect(createPlace).toHaveBeenCalledWith('seat', 5, '2-08')
    })

    it('renames in place, and cancel leaves the name as it was', async () =>
    {
        const user = userEvent.setup()
        renderFacilities()
        await user.click(await screen.findByRole('button', { name: 'Rename Riverside Annex' }))
        await user.click(screen.getByRole('button', { name: 'Cancel' }))
        expect(renamePlace).not.toHaveBeenCalled()

        await user.click(screen.getByRole('button', { name: 'Rename Riverside Annex' }))
        const box = screen.getByRole('textbox', { name: 'New name for Riverside Annex' })
        expect(box).toHaveFocus()
        await user.clear(box)
        await user.type(box, 'River Annex')
        await user.click(screen.getByRole('button', { name: 'Save name' }))
        expect(renamePlace).toHaveBeenCalledWith('building', 2, 'River Annex')
        await waitFor(() => expect(screen.queryByRole('textbox', { name: /New name for/ })).not.toBeInTheDocument())
        expect(listBuildings).toHaveBeenCalledTimes(2)
    })

    it('asks before archiving, says it cascades and that tickets keep the name; cancel sends nothing', async () =>
    {
        const user = userEvent.setup()
        renderFacilities()
        await user.click(await screen.findByRole('button', { name: 'Archive Live HQ' }))
        const dialog = await screen.findByRole('dialog', { name: 'Archive Live HQ?' })
        expect(dialog).toHaveTextContent('Its floors and seats are archived with it.')
        expect(dialog).toHaveTextContent('Tickets already reported there keep the name, marked as archived.')
        const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
        expect(cancel).toHaveFocus()
        await user.click(cancel)
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(archivePlace).not.toHaveBeenCalled()

        await user.click(screen.getByRole('button', { name: 'Archive Live HQ' }))
        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive' }))
        expect(archivePlace).toHaveBeenCalledWith('building', 1)
        await waitFor(() => expect(listBuildings).toHaveBeenCalledTimes(2))
    })

    it('words the cascade for each level, and keeps the dialog open on failure', async () =>
    {
        const user = userEvent.setup()
        archivePlace.mockRejectedValue(new ApiError({ status: 404, code: 'not_found', message: 'floor not found' }))
        renderFacilities()
        await user.click(await screen.findByRole('button', { name: 'Show floors in Live HQ' }))
        await user.click(await screen.findByRole('button', { name: 'Archive Floor 2' }))
        const dialog = await screen.findByRole('dialog', { name: 'Archive Floor 2?' })
        expect(dialog).toHaveTextContent('Its seats are archived with it.')
        await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('That could not be found.')
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: 'Show seats in Floor 2' }))
        await user.click(await screen.findByRole('button', { name: 'Archive 2-07' }))
        const seatDialog = await screen.findByRole('dialog', { name: 'Archive 2-07?' })
        expect(seatDialog).not.toHaveTextContent('archived with it')
    })

    it('shows a load failure with a retry, at the top and inside a building', async () =>
    {
        const user = userEvent.setup()
        listBuildings.mockRejectedValueOnce(new ApiError({ status: 0, code: 'network', message: 'x' }))
        listFloors.mockRejectedValueOnce(new ApiError({ status: 500, code: 'internal', message: 'boom', requestId: 'req-8' }))
        renderFacilities()
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
        await user.click(screen.getByRole('button', { name: 'Try again' }))
        await user.click(await screen.findByRole('button', { name: 'Show floors in Live HQ' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Quote reference req-8')
        await user.click(screen.getByRole('button', { name: 'Try again' }))
        expect(await screen.findByRole('list', { name: 'Floors of Live HQ' })).toBeInTheDocument()
    })

    it('says when only the first page of buildings is shown', async () =>
    {
        listBuildings.mockResolvedValue(page([HQ, ANNEX], 140))
        renderFacilities()
        expect(await screen.findByText('Showing the first 2 of 140 buildings, by name.')).toBeInTheDocument()
    })
})
