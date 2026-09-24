import { useCallback, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import AvailabilitySwitch from '../components/AvailabilitySwitch.jsx'
import DashboardSection from '../components/DashboardSection.jsx'
import ErrorNotice from '../components/ErrorNotice.jsx'
import PageLoader from '../components/PageLoader.jsx'
import StatusBoard from '../components/StatusBoard.jsx'
import TicketRow from '../components/TicketRow.jsx'
import WorkCounts from '../components/WorkCounts.jsx'
import { LIVE_POLL_MS, usePolling } from '../hooks/usePolling.js'
import { getEngineer, setAvailability } from '../services/engineerService.js'
import { listIncidents } from '../services/incidentService.js'
import { getBoard } from '../services/reportService.js'
import { tokens } from '../theme.js'

// an assigned ticket is never unassigned, so that column would always be empty
const PROFILE_STATUSES = ['open', 'in_progress', 'blocked', 'resolved', 'closed']
const REPORTED_LIMIT = 5

const nothing = () => Promise.resolve(null)

function BackLink()
{
    return <Link component={RouterLink} to="/engineers" sx={{ fontWeight: 700 }}>Back to engineers</Link>
}

// read-only "view as": the admin stays the admin and sees one engineer's work through the admin's own access (AD-09)
export default function EngineerProfilePage()
{
    const { id } = useParams()
    // anything but a number cannot be an engineer; no request is spent finding that out
    const validId = /^\d+$/.test(id)

    const loadEngineer = useCallback(() => (validId ? getEngineer(id) : nothing()), [id, validId])
    const engineer = usePolling(loadEngineer, validId ? LIVE_POLL_MS : null)
    // the api filters one field at a time and cannot OR assignee with reporter, so the two are shown apart
    const loadBoard = useCallback(() => (validId ? getBoard({ assignee_id: id, statuses: PROFILE_STATUSES }) : nothing()), [id, validId])
    const board = usePolling(loadBoard, validId ? LIVE_POLL_MS : null)
    const loadReported = useCallback(
        () => (validId ? listIncidents({ reporter_id: id, sort: '-created_at', limit: REPORTED_LIMIT }) : nothing()),
        [id, validId],
    )
    const reported = usePolling(loadReported, validId ? LIVE_POLL_MS : null)

    const [pending, setPending] = useState(false)
    const [toggleError, setToggleError] = useState(null)

    if (!validId || engineer.error?.code === 'not_found')
    {
        return (
            <Box sx={{ py: 6, display: 'grid', gap: 1.5, justifyItems: 'start' }}>
                <Typography variant="h3" component="h1">No engineer with that id</Typography>
                <Typography color="text.secondary">They may have been moved to another role, or the link is wrong.</Typography>
                <BackLink />
            </Box>
        )
    }

    const profile = engineer.data
    const toggle = async (target, isAvailable) =>
    {
        setPending(true)
        setToggleError(null)
        try
        {
            await setAvailability(target.id, isAvailable)
            await engineer.reload()
        }
        catch (failure)
        {
            setToggleError(failure)
        }
        finally
        {
            setPending(false)
        }
    }

    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 3 }}>
            <ErrorNotice
                error={engineer.error}
                action={<Button color="inherit" size="small" onClick={engineer.reload}>Try again</Button>}
            />
            {engineer.loading && !profile && <PageLoader label="Loading the engineer" />}

            {profile && (
                <>
                    <Box
                        role="note"
                        sx={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'baseline',
                            justifyContent: 'space-between',
                            columnGap: 2,
                            rowGap: 0.5,
                            px: 2,
                            py: 1.5,
                            bgcolor: tokens.tint,
                            borderLeft: `4px solid ${tokens.mark}`,
                            borderRadius: 1,
                        }}
                    >
                        <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 700 }}>Viewing {profile.full_name}'s work (read-only)</Typography>
                            <Typography variant="body2" color="text.secondary">
                                Shows tickets assigned to them; tickets they reported are listed separately.
                            </Typography>
                        </Box>
                        <BackLink />
                    </Box>

                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2 }}>
                        <Box sx={{ minWidth: 0 }}>
                            <Typography variant="h2" component="h1">{profile.full_name}</Typography>
                            <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{profile.email}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3 }}>
                            <Typography sx={{ fontWeight: 700 }}>
                                {profile.workload === 1 ? '1 active ticket' : `${profile.workload} active tickets`}
                            </Typography>
                            <AvailabilitySwitch engineer={profile} pending={pending} onToggle={toggle} />
                        </Box>
                    </Box>
                    <ErrorNotice error={toggleError} />
                </>
            )}

            {board.data && <WorkCounts columns={board.data} />}

            <DashboardSection
                id="profile-board-heading"
                title="Their tickets by status"
                intro="The most urgent in each status. Open a ticket to act on it as yourself."
                state={board}
                loadingLabel="Loading their tickets"
            >
                {(columns) => (
                    columns.every((column) => column.total === 0)
                        ? <Typography>No tickets are assigned to them.</Typography>
                        : <StatusBoard columns={columns} />
                )}
            </DashboardSection>

            <DashboardSection
                id="profile-reported-heading"
                title="Reported by them"
                intro="Problems they reported themselves, newest first."
                state={reported}
                loadingLabel="Loading what they reported"
            >
                {(page) => (
                    page.total === 0
                        ? <Typography>They have not reported any tickets.</Typography>
                        : (
                            <>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                    {page.total > page.items.length ? `Latest ${page.items.length} of ${page.total}.` : `${page.total} in total.`}
                                </Typography>
                                <Box component="ul" aria-label="Tickets they reported" sx={{ m: 0, p: 0, border: `1px solid ${tokens.rule}`, borderRadius: 1 }}>
                                    {page.items.map((incident) => <TicketRow key={incident.id} incident={incident} />)}
                                </Box>
                            </>
                        )
                )}
            </DashboardSection>
        </Box>
    )
}
