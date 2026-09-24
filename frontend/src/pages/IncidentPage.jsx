import { useCallback, useState } from 'react'
import { Link as RouterLink, useLocation, useParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import ErrorNotice from '../components/ErrorNotice.jsx'
import IncidentActions from '../components/IncidentActions.jsx'
import IncidentPlate from '../components/IncidentPlate.jsx'
import NoteThread from '../components/NoteThread.jsx'
import PageLoader from '../components/PageLoader.jsx'
import WorkflowStepper from '../components/WorkflowStepper.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { usePolling } from '../hooks/usePolling.js'
import { getIncident } from '../services/incidentService.js'
import { fmtAgo } from '../utils/format.js'

export const DETAIL_POLL_MS = 20000

export default function IncidentPage()
{
    const { id } = useParams()
    const location = useLocation()
    const { user } = useAuth()
    const load = useCallback(() => getIncident(id), [id])
    const { data: incident, error, loading, reload } = usePolling(load, DETAIL_POLL_MS)
    const [notesKey, setNotesKey] = useState(0)

    // an action can post a note (blocked, triage, escalation), so both views refresh straight away (AD-14)
    const handleChanged = () =>
    {
        reload()
        setNotesKey((key) => key + 1)
    }

    if (loading && !incident)
    {
        return <PageLoader label="Loading the ticket" />
    }
    if (!incident)
    {
        return (
            <>
                <ErrorNotice error={error} sx={{ mb: 2 }} />
                <Link component={RouterLink} to="/tickets">Back to my tickets</Link>
            </>
        )
    }

    return (
        <>
            <Link component={RouterLink} to="/tickets" sx={{ display: 'inline-block', mb: 2 }}>Back to my tickets</Link>
            {location.state?.justReported && (
                <Alert severity="success" sx={{ mb: 2 }}>
                    Your report was sent. Every step appears on this page, and the list of your tickets shows the latest.
                </Alert>
            )}
            <ErrorNotice
                error={error}
                sx={{ mb: 2 }}
                action={<Button color="inherit" size="small" onClick={reload}>Try again</Button>}
            />

            <IncidentPlate incident={incident} />

            <Paper variant="outlined" component="section" aria-labelledby="progress-heading" sx={{ mt: 3, p: { xs: 2, md: 3 } }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 2 }}>
                    <Typography id="progress-heading" variant="h5" component="h2">Progress</Typography>
                    <Typography variant="caption" color="text.secondary">Last activity {fmtAgo(incident.updated_at)}</Typography>
                </Box>
                <WorkflowStepper incident={incident} />
            </Paper>

            <Box
                sx={{
                    mt: 3,
                    display: 'grid',
                    gap: 3,
                    gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 320px' },
                    alignItems: 'start',
                }}
            >
                <Box sx={{ order: { xs: 2, md: 1 } }}>
                    <Paper variant="outlined" component="section" aria-labelledby="details-heading" sx={{ p: { xs: 2, md: 3 }, mb: 3 }}>
                        <Typography id="details-heading" variant="h5" component="h2" sx={{ mb: 1 }}>Details</Typography>
                        <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: '70ch' }}>{incident.description}</Typography>
                    </Paper>
                    <NoteThread
                        incidentId={incident.id}
                        incidentStatus={incident.status}
                        user={user}
                        refreshKey={notesKey}
                        onActivity={reload}
                    />
                </Box>
                <Box sx={{ order: { xs: 1, md: 2 }, position: { md: 'sticky' }, top: { md: 24 } }}>
                    <IncidentActions incident={incident} onChanged={handleChanged} />
                </Box>
            </Box>
        </>
    )
}
