import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ErrorNotice from './ErrorNotice.jsx'
import { fmtDateTime } from '../utils/format.js'
import { fieldError } from '../utils/errors.js'
import { tokens } from '../theme.js'

// same limit as a new note (NoteThread)
const NOTE_MAX = 5000

const ROLE_LABEL = { engineer: 'Engineer', admin: 'Facility admin' }

// notes posted by a workflow action read as events in the thread, not as chat (AD-17, AD-20)
function eventTitle(note)
{
    if (note.kind === 'blocked')
    {
        return `${note.author_name} marked this ticket as blocked`
    }
    if (note.kind === 'unassigned')
    {
        return `${note.author_name} returned this ticket to triage`
    }
    if (note.author_role === 'admin')
    {
        return `${note.author_name} updated the escalation`
    }
    return `${note.author_name} asked for escalation`
}

export default function NoteItem({ note, canEdit, canDelete, onEdit, onDelete })
{
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(note.body || '')
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)
    const deleted = note.deleted_at !== null && note.deleted_at !== undefined
    const isEvent = note.kind !== 'comment'

    const run = async (action) =>
    {
        setBusy(true)
        setError(null)
        try
        {
            await action()
            setEditing(false)
        }
        catch (actionError)
        {
            setError(actionError)
        }
        finally
        {
            setBusy(false)
        }
    }

    if (deleted)
    {
        return (
            <Box component="li" sx={{ listStyle: 'none', py: 1.5, color: 'text.secondary' }}>
                <Typography variant="body2" sx={{ fontStyle: 'italic' }}>A note was removed.</Typography>
            </Box>
        )
    }

    return (
        <Box
            component="li"
            sx={{
                listStyle: 'none',
                py: 1.5,
                ...(isEvent && { pl: 2, borderLeft: `3px solid ${note.kind === 'blocked' ? tokens.signalRed : tokens.plate}` }),
            }}
        >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1 }}>
                <Typography component="span" sx={{ fontWeight: 700 }}>
                    {isEvent ? eventTitle(note) : note.author_name}
                </Typography>
                {!isEvent && ROLE_LABEL[note.author_role] && (
                    <Typography component="span" variant="body2" color="text.secondary">{ROLE_LABEL[note.author_role]}</Typography>
                )}
                <Typography component="span" variant="caption" color="text.secondary">
                    {fmtDateTime(note.created_at)}
                    {note.edited_at && ', edited'}
                </Typography>
            </Box>

            {editing
                ? (
                    <Stack spacing={1} sx={{ mt: 1 }}>
                        <TextField
                            multiline
                            minRows={2}
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            error={Boolean(fieldError(error, 'body'))}
                            helperText={fieldError(error, 'body') || `${draft.length}/${NOTE_MAX}`}
                            disabled={busy}
                            slotProps={{ htmlInput: { 'aria-label': 'Edit note', maxLength: NOTE_MAX } }}
                        />
                        <Stack direction="row" spacing={1}>
                            <Button size="small" variant="contained" disabled={busy || !draft.trim()} onClick={() => run(() => onEdit(draft.trim()))}>
                                Save
                            </Button>
                            <Button size="small" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
                        </Stack>
                    </Stack>
                )
                : (
                    <Typography sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.body}</Typography>
                )}

            <ErrorNotice error={fieldError(error, 'body') ? null : error} sx={{ mt: 1 }} />

            {!editing && (canEdit || canDelete) && (
                <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                    {canEdit && (
                        <Button size="small" onClick={() =>
                        {
                            setDraft(note.body || '')
                            setEditing(true)
                        }}
                        >
                            Edit
                        </Button>
                    )}
                    {canDelete && (
                        <Button size="small" color="error" disabled={busy} onClick={() => run(onDelete)}>Remove</Button>
                    )}
                </Stack>
            )}
        </Box>
    )
}
