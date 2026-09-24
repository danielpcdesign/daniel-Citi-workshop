import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ErrorNotice from '../components/ErrorNotice.jsx'
import LocationSelects from '../components/LocationSelects.jsx'
import { createIncident } from '../services/incidentService.js'
import { CATEGORY_LABEL, PRIORITY_HINT, PRIORITY_LABEL } from '../utils/format.js'
import { fieldError, unplacedError } from '../utils/errors.js'

const FIELDS = ['title', 'description', 'category', 'priority', 'building_id', 'floor_id', 'seat_id']
const TITLE_MAX = 200

const EMPTY = {
    title: '',
    description: '',
    category: '',
    priority: 'medium',
    location: { buildingId: '', floorId: '', seatId: '' },
}

export default function ReportPage()
{
    const navigate = useNavigate()
    const [form, setForm] = useState(EMPTY)
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)

    const update = (name) => (event) => setForm({ ...form, [name]: event.target.value })

    // minimal client checks: something in each required field; the real rules are the server's (AD-12)
    const complete = form.title.trim() && form.description.trim() && form.category && form.location.buildingId

    const handleSubmit = async (event) =>
    {
        event.preventDefault()
        setBusy(true)
        setError(null)
        try
        {
            const incident = await createIncident({
                title: form.title.trim(),
                description: form.description.trim(),
                category: form.category,
                priority: form.priority,
                building_id: form.location.buildingId,
                floor_id: form.location.floorId || null,
                seat_id: form.location.seatId || null,
            })
            navigate(`/incidents/${incident.id}`, { state: { justReported: true } })
        }
        catch (createError)
        {
            setError(createError)
            setBusy(false)
        }
    }

    const errors = Object.fromEntries(FIELDS.map((name) => [name, fieldError(error, name)]))

    return (
        <Box sx={{ maxWidth: 720 }}>
            <Typography variant="h2" component="h1" sx={{ mb: 1 }}>Report a problem</Typography>
            <Typography color="text.secondary" sx={{ mb: 4 }}>
                Tell us what is wrong and where. A facility admin assigns an engineer, and you can follow every step on the ticket.
            </Typography>
            <Paper variant="outlined" component="form" onSubmit={handleSubmit} noValidate sx={{ p: { xs: 2.5, sm: 4 } }}>
                <Stack spacing={3}>
                    <ErrorNotice error={unplacedError(error, FIELDS)} />
                    <TextField
                        label="What is the problem?"
                        value={form.title}
                        onChange={update('title')}
                        error={Boolean(errors.title)}
                        helperText={errors.title || `A short summary, like "Kitchen tap on floor 3 is leaking". ${form.title.length}/${TITLE_MAX}`}
                        slotProps={{ htmlInput: { maxLength: TITLE_MAX } }}
                        required
                        disabled={busy}
                    />
                    <TextField
                        label="Details"
                        value={form.description}
                        onChange={update('description')}
                        error={Boolean(errors.description)}
                        helperText={errors.description || 'What you noticed, since when, and anything already tried.'}
                        multiline
                        minRows={4}
                        required
                        disabled={busy}
                    />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField
                            select
                            fullWidth
                            label="Kind of problem"
                            value={form.category}
                            onChange={update('category')}
                            error={Boolean(errors.category)}
                            helperText={errors.category}
                            required
                            disabled={busy}
                        >
                            {Object.entries(CATEGORY_LABEL).map(([code, label]) => (
                                <MenuItem key={code} value={code}>{label}</MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            select
                            fullWidth
                            label="How urgent is it?"
                            value={form.priority}
                            onChange={update('priority')}
                            error={Boolean(errors.priority)}
                            helperText={errors.priority || PRIORITY_HINT[form.priority]}
                            disabled={busy}
                        >
                            {Object.entries(PRIORITY_LABEL).map(([code, label]) => (
                                <MenuItem key={code} value={code}>{label}</MenuItem>
                            ))}
                        </TextField>
                    </Stack>
                    <LocationSelects
                        value={form.location}
                        onChange={(location) => setForm({ ...form, location })}
                        errors={errors}
                        disabled={busy}
                    />
                    <Box>
                        <Button type="submit" variant="contained" size="large" disabled={busy || !complete}>
                            {busy ? 'Sending report' : 'Send report'}
                        </Button>
                    </Box>
                </Stack>
            </Paper>
        </Box>
    )
}
