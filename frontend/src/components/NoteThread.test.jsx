import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NoteThread from './NoteThread.jsx'
import { ApiError } from '../services/http.js'
import { addNote, deleteNote, editNote, listNotes } from '../services/noteService.js'
import { ADMIN, EMPLOYEE, ENGINEER, renderPage } from '../test/render.jsx'

vi.mock('../services/noteService.js', () => ({
    listNotes: vi.fn(),
    addNote: vi.fn(),
    editNote: vi.fn(),
    deleteNote: vi.fn(),
}))

function note(overrides)
{
    return {
        id: 1,
        incident_id: 12,
        author_id: EMPLOYEE.id,
        author_name: 'Erin Employee',
        author_role: 'employee',
        kind: 'comment',
        body: 'Still dripping',
        created_at: '2026-09-21T09:00:00+00:00',
        edited_at: null,
        deleted_at: null,
        deleted_by: null,
        ...overrides,
    }
}

const THREAD = [
    note({ id: 1, edited_at: '2026-09-21T10:00:00+00:00' }),
    note({ id: 2, author_id: ENGINEER.id, author_name: 'Eli Engineer', author_role: 'engineer', body: 'On my way' }),
    note({ id: 3, author_id: ENGINEER.id, author_name: 'Eli Engineer', author_role: 'engineer', kind: 'blocked', body: 'Waiting for a valve' }),
    note({ id: 4, author_id: ADMIN.id, author_name: 'Ada Admin', author_role: 'admin', kind: 'unassigned', body: 'Eli is away' }),
    note({ id: 5, kind: 'escalation', body: 'Water near sockets' }),
    note({ id: 6, author_id: ADMIN.id, author_name: 'Ada Admin', author_role: 'admin', kind: 'escalation', body: 'Granted' }),
    note({ id: 7, body: null, deleted_at: '2026-09-21T11:00:00+00:00', deleted_by: EMPLOYEE.id }),
]

function renderThread({ user = EMPLOYEE, status = 'in_progress', onActivity = vi.fn() } = {})
{
    renderPage(<NoteThread incidentId={12} incidentStatus={status} user={user} refreshKey={0} onActivity={onActivity} />)
    return onActivity
}

function items()
{
    return within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('listitem')
}

beforeEach(() =>
{
    listNotes.mockResolvedValue({ items: THREAD, total: 7, page: 1, limit: 100 })
    addNote.mockResolvedValue({})
    editNote.mockResolvedValue({})
    deleteNote.mockResolvedValue(null)
})

describe('NoteThread', () =>
{
    it('shows comments, workflow events, edits, and removed notes', async () =>
    {
        renderThread()
        await screen.findByRole('list', { name: 'Notes' })
        const rows = items()
        expect(rows[0]).toHaveTextContent('Erin Employee')
        expect(rows[0]).toHaveTextContent(', edited')
        expect(rows[1]).toHaveTextContent('Eli EngineerEngineer')
        expect(rows[2]).toHaveTextContent('Eli Engineer marked this ticket as blocked')
        expect(rows[2]).toHaveTextContent('Waiting for a valve')
        expect(rows[3]).toHaveTextContent('Ada Admin returned this ticket to triage')
        expect(rows[4]).toHaveTextContent('Erin Employee asked for escalation')
        expect(rows[5]).toHaveTextContent('Ada Admin updated the escalation')
        expect(rows[6]).toHaveTextContent('A note was removed.')
    })

    it('lets authors edit and remove only their own notes', async () =>
    {
        renderThread()
        await screen.findByRole('list', { name: 'Notes' })
        const rows = items()
        expect(within(rows[0]).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
        expect(within(rows[0]).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
        expect(within(rows[1]).queryByRole('button')).not.toBeInTheDocument()
        expect(within(rows[6]).queryByRole('button')).not.toBeInTheDocument()
    })

    it('lets an admin remove any note, even on a closed ticket, but never edit others', async () =>
    {
        renderThread({ user: ADMIN, status: 'closed' })
        await screen.findByRole('list', { name: 'Notes' })
        const rows = items()
        expect(within(rows[1]).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
        expect(within(rows[1]).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
        expect(within(rows[3]).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
        expect(screen.queryByRole('textbox', { name: 'Add a note' })).not.toBeInTheDocument()
    })

    it('keeps a closed ticket read-only for its reporter', async () =>
    {
        renderThread({ status: 'closed' })
        await screen.findByRole('list', { name: 'Notes' })
        expect(within(items()[0]).queryByRole('button')).not.toBeInTheDocument()
    })

    it('posts a note and refreshes the thread', async () =>
    {
        const user = userEvent.setup()
        const onActivity = renderThread()
        await screen.findByRole('list', { name: 'Notes' })
        const post = screen.getByRole('button', { name: 'Post note' })
        expect(post).toBeDisabled()
        await user.type(screen.getByRole('textbox', { name: 'Add a note' }), ' Thanks! ')
        await user.click(post)
        expect(addNote).toHaveBeenCalledWith(12, 'Thanks!')
        await waitFor(() => expect(listNotes).toHaveBeenCalledTimes(2))
        expect(onActivity).toHaveBeenCalled()
        expect(screen.getByRole('textbox', { name: 'Add a note' })).toHaveValue('')
    })

    it('shows a refused post', async () =>
    {
        const user = userEvent.setup()
        addNote.mockRejectedValueOnce(new ApiError({ status: 400, code: 'validation_failed', message: 'x', fields: { body: 'Value error, must not be empty' } }))
        addNote.mockRejectedValueOnce(new ApiError({ status: 403, code: 'forbidden', message: 'a closed incident is read-only' }))
        renderThread()
        await screen.findByRole('list', { name: 'Notes' })
        await user.type(screen.getByRole('textbox', { name: 'Add a note' }), 'x')
        await user.click(screen.getByRole('button', { name: 'Post note' }))
        expect(await screen.findByText('Must not be empty')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Post note' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission')
    })

    it('edits and removes a note', async () =>
    {
        const user = userEvent.setup()
        renderThread()
        await screen.findByRole('list', { name: 'Notes' })
        await user.click(within(items()[0]).getByRole('button', { name: 'Edit' }))
        const box = screen.getByRole('textbox', { name: 'Edit note' })
        await user.clear(box)
        await user.type(box, 'Now a steady leak')
        await user.click(screen.getByRole('button', { name: 'Save' }))
        expect(editNote).toHaveBeenCalledWith(12, 1, 'Now a steady leak')
        await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit note' })).not.toBeInTheDocument())

        await user.click(within(items()[0]).getByRole('button', { name: 'Remove' }))
        expect(deleteNote).toHaveBeenCalledWith(12, 1)
    })

    it('keeps the editor open with the server message, and can cancel', async () =>
    {
        const user = userEvent.setup()
        editNote.mockRejectedValue(new ApiError({ status: 400, code: 'validation_failed', message: 'x', fields: { body: 'String should have at most 5000 characters' } }))
        deleteNote.mockRejectedValue(new ApiError({ status: 500, code: 'internal', message: 'x', requestId: 'req-3' }))
        renderThread()
        await screen.findByRole('list', { name: 'Notes' })
        await user.click(within(items()[0]).getByRole('button', { name: 'Edit' }))
        await user.click(screen.getByRole('button', { name: 'Save' }))
        expect(await screen.findByText('String should have at most 5000 characters')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Cancel' }))
        await user.click(within(items()[0]).getByRole('button', { name: 'Remove' }))
        expect(await screen.findByText('req-3')).toBeInTheDocument()
    })

    it('says when the thread is empty, or longer than one page', async () =>
    {
        listNotes.mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 100 })
        renderThread()
        expect(await screen.findByText('No notes yet.')).toBeInTheDocument()
    })

    it('says when only part of a long thread is shown', async () =>
    {
        listNotes.mockResolvedValueOnce({ items: THREAD, total: 130, page: 1, limit: 100 })
        renderThread()
        expect(await screen.findByText('Showing the first 7 of 130 notes.')).toBeInTheDocument()
    })
})
