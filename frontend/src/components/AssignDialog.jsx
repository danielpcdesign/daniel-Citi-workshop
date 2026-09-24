import { useEffect, useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ErrorNotice from './ErrorNotice.jsx'
import { listAvailableEngineers } from '../services/engineerService.js'
import { fieldError, unplacedError } from '../utils/errors.js'

function workloadText(count)
{
    return count === 1 ? '1 active ticket' : `${count} active tickets`
}

// available engineers only, least loaded first; the ordering is the server's (M7)
export default function AssignDialog({ open, onAssign, onClose })
{
    const [engineers, setEngineers] = useState(null)
    const [loadError, setLoadError] = useState(null)
    const [engineerId, setEngineerId] = useState('')
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)

    useEffect(() =>
    {
        if (!open)
        {
            return undefined
        }
        let active = true
        listAvailableEngineers()
            .then((page) =>
            {
                if (active)
                {
                    setEngineers(page.items)
                    setLoadError(null)
                }
            })
            .catch((listError) =>
            {
                if (active)
                {
                    setLoadError(listError)
                }
            })
        return () =>
        {
            active = false
        }
    }, [open])

    const close = () =>
    {
        if (!busy)
        {
            setEngineerId('')
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
            await onAssign(engineerId)
            setBusy(false)
            setEngineerId('')
            onClose()
        }
        catch (assignError)
        {
            setError(assignError)
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="assign-dialog-title">
            <form onSubmit={handleSubmit} noValidate>
                <DialogTitle id="assign-dialog-title">Assign an engineer</DialogTitle>
                <DialogContent>
                    <ErrorNotice error={loadError || unplacedError(error, ['engineer_id'])} sx={{ mb: 2 }} />
                    {engineers && engineers.length === 0 && (
                        <Typography>No engineer is available right now. Mark someone as available first.</Typography>
                    )}
                    {(!engineers || engineers.length > 0) && (
                        <TextField
                            select
                            fullWidth
                            label="Engineer"
                            value={engineerId}
                            onChange={(event) => setEngineerId(event.target.value)}
                            error={Boolean(fieldError(error, 'engineer_id'))}
                            helperText={fieldError(error, 'engineer_id') || 'Least busy first. The ticket moves to Open.'}
                            disabled={busy || !engineers}
                            sx={{ mt: 1 }}
                        >
                            {(engineers || []).map((engineer) => (
                                <MenuItem key={engineer.id} value={engineer.id}>
                                    {engineer.full_name}, {workloadText(engineer.workload)}
                                </MenuItem>
                            ))}
                        </TextField>
                    )}
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={close} disabled={busy}>Cancel</Button>
                    <Button type="submit" variant="contained" disabled={busy || !engineerId}>Assign</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
