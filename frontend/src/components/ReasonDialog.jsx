import { useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import ErrorNotice from './ErrorNotice.jsx'
import { fieldError, unplacedError } from '../utils/errors.js'

// the server's limit for transition and escalation reasons (AD-12)
export const REASON_MAX = 1000

// one dialog for every action that carries a reason; the reason is posted to the conversation by the server
export default function ReasonDialog({ open, title, prompt, label, confirmLabel, required, onConfirm, onClose })
{
    const [reason, setReason] = useState('')
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)

    const close = () =>
    {
        if (!busy)
        {
            setReason('')
            setError(null)
            onClose()
        }
    }

    const handleSubmit = async (event) =>
    {
        event.preventDefault()
        setBusy(true)
        setError(null)
        try
        {
            await onConfirm(reason.trim())
            setBusy(false)
            setReason('')
            onClose()
        }
        catch (confirmError)
        {
            setError(confirmError)
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="reason-dialog-title">
            <form onSubmit={handleSubmit} noValidate>
                <DialogTitle id="reason-dialog-title">{title}</DialogTitle>
                <DialogContent>
                    {prompt && <DialogContentText sx={{ mb: 2 }}>{prompt}</DialogContentText>}
                    <ErrorNotice error={unplacedError(error, ['reason'])} sx={{ mb: 2 }} />
                    <TextField
                        autoFocus
                        fullWidth
                        multiline
                        minRows={3}
                        label={label}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        error={Boolean(fieldError(error, 'reason'))}
                        helperText={fieldError(error, 'reason') || `${required ? 'Everyone on the ticket will see this.' : 'Optional.'} ${reason.length}/${REASON_MAX}`}
                        slotProps={{ htmlInput: { maxLength: REASON_MAX } }}
                        required={required}
                        disabled={busy}
                        sx={{ mt: 1 }}
                    />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={close} disabled={busy}>Cancel</Button>
                    <Button type="submit" variant="contained" disabled={busy || (required && !reason.trim())}>
                        {confirmLabel}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
