import { useCallback } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import ErrorNotice from './ErrorNotice.jsx'
import HistoryTimeline from './HistoryTimeline.jsx'
import PageLoader from './PageLoader.jsx'
import StatusTrack from './StatusTrack.jsx'
import { usePolling } from '../hooks/usePolling.js'
import { getIncident } from '../services/incidentService.js'
import { fmtRef } from '../utils/format.js'

const nothing = () => Promise.resolve(null)

// the status changes of the ticket picked in the lookup, from the same detail response the incident page uses
// loaded once per pick, not polled: the full page is one click away for live updates
export default function LookupHistory({ incidentId })
{
    const load = useCallback(() => (incidentId ? getIncident(incidentId) : nothing()), [incidentId])
    const detail = usePolling(load, null)

    if (!incidentId)
    {
        return (
            <Typography color="text.secondary">
                Pick a ticket in the lookup results to see how it moved.
            </Typography>
        )
    }

    const incident = detail.loading ? null : detail.data
    return (
        <Box>
            <ErrorNotice
                error={detail.error}
                sx={{ mb: 2 }}
                action={<Button color="inherit" size="small" onClick={detail.reload}>Try again</Button>}
            />
            {detail.loading && <PageLoader label="Loading the ticket's history" />}
            {incident && (
                <>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}>
                        <StatusTrack status={incident.status} />
                        <Link component={RouterLink} to={`/incidents/${incident.id}`} sx={{ fontWeight: 700 }}>
                            Open the full ticket
                        </Link>
                    </Box>
                    <HistoryTimeline
                        history={incident.history}
                        title={`${fmtRef(incident.id)} ${incident.title}`}
                        headingComponent="h4"
                        sx={{ border: 0, p: { xs: 0, md: 0 }, bgcolor: 'transparent' }}
                    />
                </>
            )}
        </Box>
    )
}
