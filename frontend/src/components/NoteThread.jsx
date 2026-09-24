import { useCallback, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ErrorNotice from './ErrorNotice.jsx'
import NoteItem from './NoteItem.jsx'
import PageLoader from './PageLoader.jsx'
import { usePolling } from '../hooks/usePolling.js'
import { addNote, deleteNote, editNote, listNotes } from '../services/noteService.js'
import { fieldError } from '../utils/errors.js'
import { tokens } from '../theme.js'

export const NOTES_POLL_MS = 20000
const MAX_BODY = 5000

// notes carry no permitted-actions list yet, so these mirror the AD-01 note rules (reported as a backend gap)
function permissions(note, user, incidentStatus)
{
    const closed = incidentStatus === 'closed'
    const author = note.author_id === user.id
    const admin = user.role === 'admin'
    return {
        canEdit: author && !closed,
        canDelete: (author || admin) && (!closed || admin),
    }
}

export default function NoteThread({ incidentId, incidentStatus, user, refreshKey, onActivity })
{
    // refreshKey is a dependency on purpose: the page bumps it after an action that posts a note
    const load = useCallback(() => listNotes(incidentId), [incidentId, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps
    const { data, error, loading, reload } = usePolling(load, NOTES_POLL_MS)
    const [draft, setDraft] = useState('')
    const [postError, setPostError] = useState(null)
    const [posting, setPosting] = useState(false)
    const closed = incidentStatus === 'closed'

    const afterChange = async () =>
    {
        await reload()
        if (onActivity)
        {
            onActivity()
        }
    }

    const handlePost = async (event) =>
    {
        event.preventDefault()
        setPosting(true)
        setPostError(null)
        try
        {
            await addNote(incidentId, draft.trim())
            setDraft('')
            await afterChange()
        }
        catch (addError)
        {
            setPostError(addError)
        }
        finally
        {
            setPosting(false)
        }
    }

    return (
        <Paper variant="outlined" component="section" aria-labelledby="conversation-heading" sx={{ p: { xs: 2, md: 3 } }}>
            <Typography id="conversation-heading" variant="h5" component="h2">Conversation</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Everyone on this ticket sees these notes: the reporter, the engineer, and facility admins.
            </Typography>

            <ErrorNotice error={error} sx={{ mb: 2 }} />
            {loading && !data && <PageLoader label="Loading the conversation" />}

            {data && data.items.length === 0 && (
                <Typography color="text.secondary" sx={{ py: 1 }}>No notes yet.</Typography>
            )}
            {data && data.items.length > 0 && (
                <Box component="ol" sx={{ m: 0, p: 0, '& > li + li': { borderTop: `1px solid ${tokens.rule}` } }} aria-label="Notes">
                    {data.items.map((note) =>
                    {
                        const allowed = permissions(note, user, incidentStatus)
                        return (
                            <NoteItem
                                key={note.id}
                                note={note}
                                canEdit={allowed.canEdit}
                                canDelete={allowed.canDelete}
                                onEdit={async (body) =>
                                {
                                    await editNote(incidentId, note.id, body)
                                    await afterChange()
                                }}
                                onDelete={async () =>
                                {
                                    await deleteNote(incidentId, note.id)
                                    await afterChange()
                                }}
                            />
                        )
                    })}
                </Box>
            )}
            {data && data.total > data.items.length && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Showing the first {data.items.length} of {data.total} notes.
                </Typography>
            )}

            {closed
                ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                        This ticket is closed, so the conversation is read-only.
                    </Typography>
                )
                : (
                    <Stack component="form" onSubmit={handlePost} noValidate spacing={1.25} sx={{ mt: 2 }}>
                        <TextField
                            label="Add a note"
                            multiline
                            minRows={2}
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            error={Boolean(fieldError(postError, 'body'))}
                            helperText={fieldError(postError, 'body') || `${draft.length}/${MAX_BODY}`}
                            slotProps={{ htmlInput: { maxLength: MAX_BODY } }}
                            disabled={posting}
                        />
                        <ErrorNotice error={fieldError(postError, 'body') ? null : postError} />
                        <Box>
                            <Button type="submit" variant="contained" disabled={posting || !draft.trim()}>
                                {posting ? 'Posting' : 'Post note'}
                            </Button>
                        </Box>
                    </Stack>
                )}
        </Paper>
    )
}
