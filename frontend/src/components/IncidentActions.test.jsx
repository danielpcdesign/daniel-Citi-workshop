import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IncidentActions from './IncidentActions.jsx'
import { ApiError } from '../services/http.js'
import { assignIncident, decideEscalation, requestEscalation, transitionIncident } from '../services/incidentService.js'
import { listAvailableEngineers } from '../services/engineerService.js'
import { incidentFixture, renderPage } from '../test/render.jsx'

vi.mock('../services/incidentService.js', () => ({
    transitionIncident: vi.fn(),
    assignIncident: vi.fn(),
    requestEscalation: vi.fn(),
    decideEscalation: vi.fn(),
}))
vi.mock('../services/engineerService.js', () => ({ listAvailableEngineers: vi.fn() }))

const NONE = { edit: [], delete: false, assign: false, transitions: [], request_escalation: false, set_escalation: false }

function renderActions(overrides, onChanged = vi.fn())
{
    const incident = incidentFixture({ ...overrides, actions: { ...NONE, ...overrides.actions } })
    renderPage(<IncidentActions incident={incident} onChanged={onChanged} />)
    return onChanged
}

beforeEach(() =>
{
    transitionIncident.mockResolvedValue({})
    assignIncident.mockResolvedValue({})
    requestEscalation.mockResolvedValue({})
    decideEscalation.mockResolvedValue({})
})

describe('IncidentActions', () =>
{
    it('offers nothing the server did not list', () =>
    {
        renderActions({ status: 'in_progress' })
        expect(screen.queryAllByRole('button')).toHaveLength(0)
        expect(screen.getByRole('heading', { name: 'What happens next' })).toBeInTheDocument()
    })

    it('moves directly when no reason is needed, and marks the natural next step', async () =>
    {
        const user = userEvent.setup()
        const onChanged = renderActions({ status: 'in_progress', actions: { transitions: ['blocked', 'resolved'] } })
        const fixed = screen.getByRole('button', { name: 'Mark as fixed' })
        expect(fixed).toHaveClass('MuiButton-contained')
        expect(screen.getByRole('button', { name: 'Mark as blocked' })).toHaveClass('MuiButton-outlined')
        await user.click(fixed)
        expect(transitionIncident).toHaveBeenCalledWith(12, 'resolved')
        expect(onChanged).toHaveBeenCalled()
    })

    it('asks why before blocking, and needs an answer', async () =>
    {
        const user = userEvent.setup()
        const onChanged = renderActions({ status: 'in_progress', actions: { transitions: ['blocked'] } })
        await user.click(screen.getByRole('button', { name: 'Mark as blocked' }))
        const dialog = await screen.findByRole('dialog', { name: 'What is blocking this ticket?' })
        const confirm = within(dialog).getByRole('button', { name: 'Mark as blocked' })
        expect(confirm).toBeDisabled()
        await user.type(within(dialog).getByRole('textbox'), '  Waiting for parts  ')
        await user.click(confirm)
        expect(transitionIncident).toHaveBeenCalledWith(12, 'blocked', 'Waiting for parts')
        expect(onChanged).toHaveBeenCalled()
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('shows the server reason message in the dialog and keeps it open', async () =>
    {
        const user = userEvent.setup()
        transitionIncident.mockRejectedValue(new ApiError({ status: 400, code: 'validation_failed', message: 'a reason is required', fields: { reason: 'required when moving to unassigned' } }))
        renderActions({ status: 'open', assignee_name: 'Eli', actions: { transitions: ['unassigned'] } })
        await user.click(screen.getByRole('button', { name: 'Return to triage' }))
        const dialog = await screen.findByRole('dialog', { name: 'Return this ticket to triage' })
        await user.type(within(dialog).getByRole('textbox'), 'x')
        await user.click(within(dialog).getByRole('button', { name: 'Return to triage' }))
        expect(await within(dialog).findByText('Required when moving to unassigned')).toBeInTheDocument()
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('reports a refused move beside the buttons', async () =>
    {
        const user = userEvent.setup()
        transitionIncident.mockRejectedValue(new ApiError({ status: 403, code: 'forbidden', message: 'no' }))
        renderActions({ status: 'blocked', actions: { transitions: ['in_progress'] } })
        await user.click(screen.getByRole('button', { name: 'Resume work' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to do that.')
    })

    it('lets an admin assign from available engineers, least busy first', async () =>
    {
        const user = userEvent.setup()
        listAvailableEngineers.mockResolvedValue({ items: [{ id: 41, full_name: 'Eli Engineer', workload: 1 }, { id: 43, full_name: 'Una', workload: 3 }], total: 2, page: 1, limit: 100 })
        const onChanged = renderActions({ status: 'unassigned', actions: { assign: true, set_escalation: true } })
        await user.click(screen.getByRole('button', { name: 'Assign an engineer' }))
        const dialog = await screen.findByRole('dialog', { name: 'Assign an engineer' })
        expect(within(dialog).getByRole('button', { name: 'Assign' })).toBeDisabled()
        await user.click(await within(dialog).findByRole('combobox', { name: /Engineer/ }))
        const options = await screen.findAllByRole('option')
        expect(options.map((option) => option.textContent)).toEqual(['Eli Engineer, 1 active ticket', 'Una, 3 active tickets'])
        await user.click(options[1])
        await user.click(within(dialog).getByRole('button', { name: 'Assign' }))
        expect(assignIncident).toHaveBeenCalledWith(12, 43)
        expect(onChanged).toHaveBeenCalled()
    })

    it('shows a refused assignment beside the picker', async () =>
    {
        const user = userEvent.setup()
        listAvailableEngineers.mockResolvedValue({ items: [{ id: 41, full_name: 'Eli', workload: 0 }], total: 1, page: 1, limit: 100 })
        assignIncident.mockRejectedValue(new ApiError({ status: 400, code: 'validation_failed', message: 'invalid assignee', fields: { engineer_id: 'engineer 41 is not available' } }))
        renderActions({ status: 'unassigned', actions: { assign: true } })
        await user.click(screen.getByRole('button', { name: 'Assign an engineer' }))
        const dialog = await screen.findByRole('dialog')
        await user.click(await within(dialog).findByRole('combobox'))
        await user.click(await screen.findByRole('option', { name: /Eli/ }))
        await user.click(within(dialog).getByRole('button', { name: 'Assign' }))
        expect(await within(dialog).findByText('Engineer 41 is not available')).toBeInTheDocument()
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    })

    it('says when nobody is available, or the list cannot load', async () =>
    {
        const user = userEvent.setup()
        listAvailableEngineers.mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 100 })
        renderActions({ status: 'unassigned', actions: { assign: true } })
        await user.click(screen.getByRole('button', { name: 'Assign an engineer' }))
        expect(await screen.findByText(/No engineer is available right now/)).toBeInTheDocument()
    })

    it('shows a failed engineer list', async () =>
    {
        const user = userEvent.setup()
        listAvailableEngineers.mockRejectedValueOnce(new ApiError({ status: 0, code: 'network', message: 'x' }))
        renderActions({ status: 'unassigned', actions: { assign: true } })
        await user.click(screen.getByRole('button', { name: 'Assign an engineer' }))
        const dialog = await screen.findByRole('dialog')
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not reach the server')
    })

    it('lets the reporter ask for escalation with a reason', async () =>
    {
        const user = userEvent.setup()
        renderActions({ status: 'open', actions: { request_escalation: true } })
        await user.click(screen.getByRole('button', { name: 'Ask for escalation' }))
        const dialog = await screen.findByRole('dialog', { name: 'Ask for escalation' })
        await user.type(within(dialog).getByRole('textbox'), 'Water near sockets')
        await user.click(within(dialog).getByRole('button', { name: 'Send request' }))
        expect(requestEscalation).toHaveBeenCalledWith(12, 'Water near sockets')
    })

    it('lets an admin decide, offering only changes from the current state', async () =>
    {
        const user = userEvent.setup()
        renderActions({ status: 'open', escalation_status: 'pending', actions: { set_escalation: true, transitions: ['in_progress', 'closed'] } })
        expect(screen.getByText('Escalation requested')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Grant escalation' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Clear escalation' })).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Decline escalation' }))
        const dialog = await screen.findByRole('dialog', { name: 'Decline escalation' })
        await user.type(within(dialog).getByRole('textbox'), 'Not urgent')
        await user.click(within(dialog).getByRole('button', { name: 'Decline escalation' }))
        expect(decideEscalation).toHaveBeenCalledWith(12, 'declined', 'Not urgent')
    })

    it('hides the current escalation state from the choices', () =>
    {
        renderActions({ status: 'in_progress', escalation_status: 'granted', actions: { set_escalation: true, transitions: ['open'] } })
        expect(screen.queryByRole('button', { name: 'Grant escalation' })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Move back to Open' })).toBeInTheDocument()
    })
})
