import { useCallback } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import AttentionList from '../components/AttentionList.jsx'
import CountBars from '../components/CountBars.jsx'
import DashboardSection from '../components/DashboardSection.jsx'
import ErrorNotice from '../components/ErrorNotice.jsx'
import HotspotList from '../components/HotspotList.jsx'
import PageLoader from '../components/PageLoader.jsx'
import StatusBoard from '../components/StatusBoard.jsx'
import SummaryPlate from '../components/SummaryPlate.jsx'
import TimingTrack from '../components/TimingTrack.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { usePolling } from '../hooks/usePolling.js'
import { getAttention, getBoard, getHotspots, getSummary, getTimings } from '../services/reportService.js'
import { CATEGORY_LABEL, PRIORITY_LABEL } from '../utils/format.js'
import { tokens } from '../theme.js'

export const DASHBOARD_POLL_MS = 30000

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']
const PRIORITY_COLOR = { critical: tokens.signalRed, high: tokens.signalAmber }

// the admin sees every ticket; an engineer's counts and board are the server's visibility for them (AD-09, AD-19)
const SCOPE = {
    admin: 'Every ticket across all buildings.',
    engineer: 'Tickets assigned to you or reported by you.',
}

function priorityRows(byPriority)
{
    return PRIORITY_ORDER.map((key) => ({ key, label: PRIORITY_LABEL[key], count: byPriority[key], color: PRIORITY_COLOR[key] }))
}

// most common first, empty categories left out: "what are the most common issue categories" (required question)
function categoryRows(byCategory)
{
    return Object.entries(byCategory)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ key, label: CATEGORY_LABEL[key] || key, count }))
}

export default function DashboardPage()
{
    const { user } = useAuth()
    const isAdmin = user.role === 'admin'

    // live views poll every 30 s while the tab is visible (AD-14)
    const summary = usePolling(getSummary, DASHBOARD_POLL_MS)
    const board = usePolling(getBoard, DASHBOARD_POLL_MS)
    // admin-only reports are never requested for an engineer: they would only answer 403
    const loadAttention = useCallback(() => (isAdmin ? getAttention() : Promise.resolve(null)), [isAdmin])
    const attention = usePolling(loadAttention, isAdmin ? DASHBOARD_POLL_MS : null)
    // timings and hotspots change slowly and scan the history: on demand only (AD-14)
    const loadTimings = useCallback(() => (isAdmin ? getTimings() : Promise.resolve(null)), [isAdmin])
    const timings = usePolling(loadTimings, null)
    const loadHotspots = useCallback(() => (isAdmin ? getHotspots() : Promise.resolve(null)), [isAdmin])
    const hotspots = usePolling(loadHotspots, null)
    // the breakdowns reuse the summary; its failure is already shown once, above the plate
    const summaryShown = { ...summary, error: null }

    return (
        <Box sx={{ display: 'grid', gap: 3 }}>
            <Box>
                <Typography variant="h2" component="h1">Dashboard</Typography>
                <Typography color="text.secondary">
                    {isAdmin ? 'What needs doing, what is stuck, and how fast tickets move.' : 'Where your work stands.'}
                    {' '}Refreshes every 30 seconds.
                </Typography>
            </Box>

            <Box>
                <ErrorNotice
                    error={summary.error}
                    sx={{ mb: 2 }}
                    action={<Button color="inherit" size="small" onClick={summary.reload}>Try again</Button>}
                />
                {summary.loading && !summary.data && <PageLoader label="Loading the summary" />}
                {summary.data && <SummaryPlate summary={summary.data} scopeNote={SCOPE[user.role]} />}
            </Box>

            {isAdmin && (
                <DashboardSection
                    id="attention-heading"
                    title="Needs attention"
                    intro="Blocked tickets and escalation requests, oldest first, with the reason given."
                    state={attention}
                    loadingLabel="Loading what needs attention"
                >
                    {(data) => <AttentionList attention={data} />}
                </DashboardSection>
            )}

            <DashboardSection
                id="board-heading"
                title="Tickets by status"
                intro="The most urgent tickets in each status. Open a ticket to move it along."
                state={board}
                loadingLabel="Loading the board"
            >
                {(columns) => <StatusBoard columns={columns} />}
            </DashboardSection>

            {summary.data && (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
                    <DashboardSection id="category-heading" title="Kinds of problem" intro="All tickets, closed ones included." state={summaryShown}>
                        {(data) => <CountBars label="Tickets by kind of problem" rows={categoryRows(data.by_category)} emptyText="No tickets yet." />}
                    </DashboardSection>
                    <DashboardSection id="priority-heading" title="Priority" intro="All tickets, closed ones included." state={summaryShown}>
                        {(data) => <CountBars label="Tickets by priority" rows={priorityRows(data.by_priority)} emptyText="No tickets yet." />}
                    </DashboardSection>
                </Box>
            )}

            {isAdmin && (
                <>
                    <DashboardSection
                        id="timings-heading"
                        title="How fast tickets move"
                        intro="Typical time from a report to each step, over every ticket that reached it."
                        action={<Button variant="outlined" size="small" onClick={timings.reload}>Refresh timings</Button>}
                        state={timings}
                        loadingLabel="Loading timings"
                    >
                        {(data) => <TimingTrack timings={data} />}
                    </DashboardSection>
                    <DashboardSection
                        id="hotspots-heading"
                        title="Where problems recur"
                        intro="Places with the most tickets, closed ones included."
                        action={<Button variant="outlined" size="small" onClick={hotspots.reload}>Refresh hotspots</Button>}
                        state={hotspots}
                        loadingLabel="Loading hotspots"
                    >
                        {(data) => <HotspotList hotspots={data} />}
                    </DashboardSection>
                </>
            )}
        </Box>
    )
}
