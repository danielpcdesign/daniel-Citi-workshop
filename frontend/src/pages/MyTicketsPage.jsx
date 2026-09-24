import { useCallback } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Pagination from '@mui/material/Pagination'
import Paper from '@mui/material/Paper'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import ErrorNotice from '../components/ErrorNotice.jsx'
import PageLoader from '../components/PageLoader.jsx'
import TicketRow from '../components/TicketRow.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { usePolling } from '../hooks/usePolling.js'
import { listIncidents } from '../services/incidentService.js'

export const TICKETS_POLL_MS = 60000
const PAGE_SIZE = 20

// each view is a server-side status filter (AD-13); "open" here means anything not yet closed
const VIEWS = {
    active: { label: 'Not closed', status: ['unassigned', 'open', 'in_progress', 'blocked', 'resolved'] },
    closed: { label: 'Closed', status: ['closed'] },
    all: { label: 'All', status: [] },
}

export default function MyTicketsPage()
{
    const { user } = useAuth()
    const [params, setParams] = useSearchParams()
    const view = VIEWS[params.get('view')] ? params.get('view') : 'active'
    const page = Math.max(1, Number(params.get('page')) || 1)

    // everyone is an employee too: "my tickets" means reported by me, whatever the role (AD-09)
    const load = useCallback(
        () => listIncidents({
            reporter_id: user.id,
            status: VIEWS[view].status,
            // latest activity first: a reply or a status change brings the ticket to the top
            sort: '-updated_at',
            page,
            limit: PAGE_SIZE,
        }),
        [user.id, view, page],
    )
    const { data, error, loading, reload } = usePolling(load, TICKETS_POLL_MS)

    const go = (next) => setParams({ view: next.view ?? view, page: String(next.page ?? 1) })
    const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

    return (
        <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 2, mb: 3 }}>
                <Box sx={{ flex: '1 1 320px' }}>
                    <Typography variant="h2" component="h1">My tickets</Typography>
                    <Typography color="text.secondary">Problems you reported, with the latest activity first.</Typography>
                </Box>
                <Button component={RouterLink} to="/report" variant="contained">Report a problem</Button>
            </Box>

            <ToggleButtonGroup
                exclusive
                size="small"
                value={view}
                onChange={(event, next) =>
                {
                    if (next)
                    {
                        go({ view: next })
                    }
                }}
                aria-label="Which tickets to show"
                sx={{ mb: 2 }}
            >
                {Object.entries(VIEWS).map(([key, option]) => (
                    <ToggleButton key={key} value={key} sx={{ textTransform: 'none', px: 2 }}>{option.label}</ToggleButton>
                ))}
            </ToggleButtonGroup>

            <ErrorNotice
                error={error}
                sx={{ mb: 2 }}
                action={<Button color="inherit" size="small" onClick={reload}>Try again</Button>}
            />

            {loading && !data && <PageLoader label="Loading your tickets" />}

            {data && data.items.length === 0 && (
                <Paper variant="outlined" sx={{ p: 4 }}>
                    <Typography variant="h5" component="p" sx={{ mb: 1 }}>
                        {view === 'closed' ? 'No closed tickets yet' : 'Nothing reported here'}
                    </Typography>
                    <Typography sx={{ mb: 2 }}>
                        When something at work is broken or not working right, report it and follow it here.
                    </Typography>
                    <Button component={RouterLink} to="/report" variant="outlined">Report a problem</Button>
                </Paper>
            )}

            {data && data.items.length > 0 && (
                <Paper variant="outlined">
                    <Box component="ul" sx={{ m: 0, p: 0 }} aria-label="Tickets">
                        {data.items.map((incident) => <TicketRow key={incident.id} incident={incident} />)}
                    </Box>
                </Paper>
            )}

            {data && pages > 1 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2, flexWrap: 'wrap' }}>
                    <Pagination count={pages} page={page} onChange={(event, next) => go({ page: next })} />
                    <Typography variant="body2" color="text.secondary">{data.total} tickets</Typography>
                </Box>
            )}
        </>
    )
}
