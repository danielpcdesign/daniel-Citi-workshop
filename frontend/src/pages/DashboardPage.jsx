import { useCallback, useRef, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import { MOBILE_QUERY } from '../components/AppShell.jsx'
import AttentionList from '../components/AttentionList.jsx'
import CollapsibleSection from '../components/CollapsibleSection.jsx'
import CountBars from '../components/CountBars.jsx'
import DashboardNav from '../components/DashboardNav.jsx'
import DashboardSection from '../components/DashboardSection.jsx'
import ErrorNotice from '../components/ErrorNotice.jsx'
import HotspotList from '../components/HotspotList.jsx'
import LookupHistory from '../components/LookupHistory.jsx'
import PageLoader from '../components/PageLoader.jsx'
import StatusBoard from '../components/StatusBoard.jsx'
import SummaryPlate from '../components/SummaryPlate.jsx'
import TicketLookup from '../components/TicketLookup.jsx'
import TimingTrack from '../components/TimingTrack.jsx'
import { useActiveSection } from '../hooks/useActiveSection.js'
import { useAuth } from '../hooks/useAuth.js'
import { LIVE_POLL_MS, usePolling } from '../hooks/usePolling.js'
import { getAttention, getBoard, getHotspots, getSummary, getTimings } from '../services/reportService.js'
import { CATEGORY_LABEL, PRIORITY_LABEL, fmtRef } from '../utils/format.js'
import { scrollToSection } from '../utils/scroll.js'
import { radius, tokens } from '../theme.js'

export const DASHBOARD_POLL_MS = LIVE_POLL_MS

// the section anchors the dashboard nav jumps to
const SECTION = {
    now: 'dash-now',
    status: 'dash-status',
    timings: 'dash-timings',
    hotspots: 'dash-hotspots',
    lookup: 'dash-lookup',
    history: 'dash-history',
}

// below MUI's lg breakpoint the history sits under the results instead of beside them
const STACKED_QUERY = '(max-width: 1199px)'

const LOOKUP_CHILDREN = [{ id: SECTION.history, label: 'History' }]
const NAV = {
    admin: [
        { id: SECTION.now, label: 'Needs attention / Right now' },
        { id: SECTION.status, label: 'Tickets by status' },
        { id: SECTION.timings, label: 'How fast tickets move' },
        { id: SECTION.hotspots, label: 'Where problems occur' },
        { id: SECTION.lookup, label: 'Lookup tool', children: LOOKUP_CHILDREN },
    ],
    engineer: [
        { id: SECTION.now, label: 'Right now' },
        { id: SECTION.status, label: 'Tickets by status' },
        { id: SECTION.lookup, label: 'Lookup tool', children: LOOKUP_CHILDREN },
    ],
}

// a jump target: clear of the sticky phone nav, and focusable so the keyboard carries on from there
const anchorSx = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 3, scrollMarginTop: { xs: 64, md: 16 }, '&:focus': { outline: 'none' } }

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
    const isMobile = useMediaQuery({ query: MOBILE_QUERY })
    const isStacked = useMediaQuery({ query: STACKED_QUERY })

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

    // both start closed; the lookup asks the server for nothing until it has been opened once
    const [lookupOpen, setLookupOpen] = useState(false)
    const [lookupUsed, setLookupUsed] = useState(false)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [selected, setSelected] = useState(null)

    const nav = NAV[user.role] || NAV.engineer
    const navIds = nav.flatMap((section) => [section.id, ...(section.children || []).map((child) => child.id)])
    const [active, setActive] = useActiveSection(navIds)

    const toggleLookup = (open) =>
    {
        setLookupOpen(open)
        if (open)
        {
            setLookupUsed(true)
        }
    }

    // a jump to a closed section waits until every section it opens has finished opening: MUI sizes the
    // animation by content height, so a fixed delay would scroll while the page is still growing
    const pendingJump = useRef(null)
    const jump = (id, opening, focus = true) =>
    {
        pendingJump.current = opening > 0 ? { id, opening, focus } : null
        if (opening === 0)
        {
            scrollToSection(id, { focus })
        }
    }
    const onOpened = () =>
    {
        const pending = pendingJump.current
        if (!pending)
        {
            return
        }
        pending.opening -= 1
        if (pending.opening === 0)
        {
            pendingJump.current = null
            scrollToSection(pending.id, { focus: pending.focus })
        }
    }

    const goTo = (id) =>
    {
        let opening = 0
        if ((id === SECTION.lookup || id === SECTION.history) && !lookupOpen)
        {
            toggleLookup(true)
            opening += 1
        }
        if (id === SECTION.history && !historyOpen)
        {
            setHistoryOpen(true)
            opening += 1
        }
        setActive(id)
        jump(id, opening)
    }

    const selectTicket = (incident) =>
    {
        setSelected(incident)
        setHistoryOpen(true)
        // side by side the history is already in view; stacked beneath 20 results it is not
        // the picked row keeps focus: the scroll is for the eye
        if (isStacked)
        {
            jump(SECTION.history, historyOpen ? 0 : 1, false)
        }
    }

    const history = (
        <CollapsibleSection
            id={SECTION.history}
            title="History"
            hint={selected ? `Showing ${fmtRef(selected.id)}` : 'No ticket picked yet.'}
            headingComponent="h3"
            titleVariant="h5"
            expanded={historyOpen}
            onToggle={setHistoryOpen}
            onOpened={onOpened}
            sx={{ position: { lg: 'sticky' }, top: { lg: 16 } }}
        >
            <LookupHistory incidentId={selected?.id ?? null} />
        </CollapsibleSection>
    )

    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : '208px minmax(0, 1fr)', columnGap: 5, alignItems: 'start' }}>
            {!isMobile && <DashboardNav sections={nav} active={active} onGo={goTo} />}

            {/* minmax(0, 1fr), not auto: the board's six columns must scroll inside it, not widen the page */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 3, minWidth: 0 }}>
                <Box>
                    <Typography variant="h2" component="h1">Dashboard</Typography>
                    <Typography color="text.secondary">
                        {isAdmin ? 'What needs doing, what is stuck, and how fast tickets move.' : 'Where your work stands.'}
                        {' '}Refreshes every 30 seconds.
                    </Typography>
                </Box>

                {isMobile && <DashboardNav sections={nav} active={active} onGo={goTo} compact />}

                <Box id={SECTION.now} tabIndex={-1} sx={anchorSx}>
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
                </Box>

                <Box id={SECTION.status} tabIndex={-1} sx={anchorSx}>
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
                </Box>

                {isAdmin && (
                    <>
                        <Box id={SECTION.timings} tabIndex={-1} sx={anchorSx}>
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
                        </Box>
                        <Box id={SECTION.hotspots} tabIndex={-1} sx={anchorSx}>
                            <DashboardSection
                                id="hotspots-heading"
                                title="Where problems occur"
                                intro="Places with the most tickets, closed ones included."
                                action={<Button variant="outlined" size="small" onClick={hotspots.reload}>Refresh hotspots</Button>}
                                state={hotspots}
                                loadingLabel="Loading hotspots"
                            >
                                {(data) => <HotspotList hotspots={data} />}
                            </DashboardSection>
                        </Box>
                    </>
                )}

                <CollapsibleSection
                    id={SECTION.lookup}
                    title="Look up a ticket"
                    hint="Search by number or words, then narrow by status, place, or engineer."
                    icon={(
                        <Box
                            component="span"
                            aria-hidden="true"
                            sx={{ width: 40, height: 40, flexShrink: 0, display: 'grid', placeItems: 'center', bgcolor: tokens.plate, color: tokens.paper, borderRadius: `${radius.control}px` }}
                        >
                            <SearchIcon />
                        </Box>
                    )}
                    expanded={lookupOpen}
                    onToggle={toggleLookup}
                    onOpened={onOpened}
                >
                    <TicketLookup
                        enabled={lookupUsed}
                        isAdmin={isAdmin}
                        selectedId={selected?.id ?? null}
                        onSelect={selectTicket}
                        aside={history}
                    />
                </CollapsibleSection>
            </Box>
        </Box>
    )
}
