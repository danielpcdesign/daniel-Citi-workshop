import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import ErrorNotice from './ErrorNotice.jsx'
import { nameError } from '../utils/facilities.js'

// one name box for adding or renaming a place; the server decides what is valid, and its reason sits under the box
// onSubmit(name) resolves when saved; an add clears itself for the next one, a rename is closed by its owner
export default function NameForm({ label, initialName = '', submitLabel, busyLabel, onSubmit, onCancel, autoFocus })
{
    const [name, setName] = useState(initialName)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const beside = nameError(error)

    const submit = async (event) =>
    {
        event.preventDefault()
        setBusy(true)
        setError(null)
        try
        {
            await onSubmit(name.trim())
            if (!initialName)
            {
                setName('')
            }
        }
        catch (failure)
        {
            setError(failure)
        }
        finally
        {
            setBusy(false)
        }
    }

    return (
        <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: 1 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 1 }}>
                <TextField
                    size="small"
                    label={label}
                    value={name}
                    autoFocus={autoFocus}
                    onChange={(event) => setName(event.target.value)}
                    error={Boolean(beside)}
                    helperText={beside}
                    slotProps={{ htmlInput: { maxLength: 100 } }}
                    sx={{ flex: '1 1 220px', minWidth: 0 }}
                />
                <Button type="submit" variant="contained" disabled={busy || !name.trim()}>
                    {busy ? busyLabel : submitLabel}
                </Button>
                {onCancel && <Button onClick={onCancel} disabled={busy}>Cancel</Button>}
            </Box>
            {/* anything that is not about the name itself: network, permissions, a parent archived meanwhile */}
            <ErrorNotice error={beside ? null : error} />
        </Box>
    )
}
