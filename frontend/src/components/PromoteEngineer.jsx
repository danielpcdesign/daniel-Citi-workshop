import { useCallback, useState } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import { SEARCH_DEBOUNCE_MS } from './TicketLookup.jsx'
import { useDebounced } from '../hooks/useDebounced.js'
import { usePolling } from '../hooks/usePolling.js'
import { searchEmployees } from '../services/userService.js'

function label(user)
{
    return `${user.full_name} (${user.email})`
}

// the server filters by name or email and offers employees only; the browser shows what it returns (AD-13)
export default function PromoteEngineer({ busy, onPromote })
{
    const [search, setSearch] = useState('')
    const [text, setText] = useState('')
    const [picked, setPicked] = useState(null)
    const q = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS)
    const load = useCallback(() => searchEmployees(q), [q])
    const found = usePolling(load, null)

    const submit = async (event) =>
    {
        event.preventDefault()
        const done = await onPromote(picked)
        if (done)
        {
            setPicked(null)
            setText('')
            setSearch('')
            found.reload()
        }
    }

    return (
        <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 1.5 }}>
            <Autocomplete
                sx={{ flex: '1 1 280px', minWidth: 0 }}
                size="small"
                options={found.data?.items || []}
                loading={found.loading}
                value={picked}
                inputValue={text}
                onChange={(event, user) => setPicked(user)}
                onInputChange={(event, value, reason) =>
                {
                    setText(value)
                    // picking an option fills the box with its label; only typing is a new search
                    if (reason === 'input' || reason === 'clear')
                    {
                        setSearch(value)
                    }
                }}
                // already filtered on the server: filtering again by the label would hide email matches
                filterOptions={(options) => options}
                getOptionLabel={label}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                noOptionsText={found.error ? 'Employees could not be loaded.' : 'No employee matches.'}
                loadingText="Searching employees"
                renderInput={(params) => <TextField {...params} label="Find an employee" />}
            />
            <Button type="submit" variant="contained" disabled={!picked || busy}>
                {busy ? 'Making engineer' : 'Make engineer'}
            </Button>
        </Box>
    )
}
