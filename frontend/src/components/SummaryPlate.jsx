import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { fmtAgo, fmtRef } from '../utils/format.js'
import { radius, tokens } from '../theme.js'

const ON_PLATE_MUTED = 'rgba(244, 246, 247, 0.78)'

// work not yet handed back to the reporter; resolved waits on an admin, so it is counted on its own
function openWork(byStatus)
{
    return byStatus.unassigned + byStatus.open + byStatus.in_progress + byStatus.blocked
}

// each figure is also the question "which tickets?": the same server filters the count was made from (AD-13)
const FIGURES = [
    { key: 'open', label: 'Open work', count: (summary) => openWork(summary.by_status), query: { status: ['unassigned', 'open', 'in_progress', 'blocked'] } },
    { key: 'waiting', label: 'Waiting for an engineer', count: (summary) => summary.by_status.unassigned, query: { status: ['unassigned'] } },
    { key: 'blocked', label: 'Blocked', alarm: true, count: (summary) => summary.by_status.blocked, query: { status: ['blocked'] } },
    { key: 'escalation', label: 'Escalation requested', alarm: true, count: (summary) => summary.by_escalation.pending, query: { escalation_status: 'pending' } },
    { key: 'resolved', label: 'Fixed, waiting to close', count: (summary) => summary.by_status.resolved, query: { status: ['resolved'] } },
]

function Figure({ label, value, alarm, onOpen })
{
    // term before value in the markup, as a description list requires; the number is drawn on top
    // the number is a button whose hit area stretches over the whole figure, label included
    return (
        <Box sx={{ position: 'relative', minWidth: 0, display: 'flex', flexDirection: 'column-reverse', justifyContent: 'flex-end' }}>
            <Typography component="dt" variant="body2" sx={{ mt: 0.75, color: ON_PLATE_MUTED, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                {/* a red mark, not red text: red on the navy plate would fail contrast */}
                {alarm && value > 0 && (
                    <Box component="span" aria-hidden="true" sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: tokens.signalRed, flexShrink: 0 }} />
                )}
                {label}
            </Typography>
            <Typography component="dd" sx={{ m: 0 }}>
                <Box
                    component="button"
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={`${label}: ${value === 1 ? '1 ticket' : `${value} tickets`}. Show them`}
                    onClick={onOpen}
                    sx={{
                        p: 0,
                        border: 0,
                        bgcolor: 'transparent',
                        color: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'Overpass, sans-serif',
                        fontWeight: 800,
                        fontSize: { xs: '2rem', md: '2.6rem' },
                        lineHeight: 1,
                        // the whole figure is the target, and it is where the focus ring is drawn
                        '&::after': { content: '""', position: 'absolute', inset: -8, borderRadius: '6px' },
                        '&:hover': { textDecoration: 'underline', textDecorationThickness: 3, textUnderlineOffset: 6 },
                        '&:hover::after': { bgcolor: 'rgba(244, 246, 247, 0.06)' },
                        '&:focus-visible': { outline: 'none' },
                        '&:focus-visible::after': { outline: `3px solid ${tokens.signalAmber}`, outlineOffset: 2 },
                    }}
                >
                    {value}
                </Box>
            </Typography>
        </Box>
    )
}

// the dashboard's one bold element: the state of the building's work on a single sign (AD-19 /summary)
// onOpen(figure): figure is { key, label, count, query } for the ticket drawer
export default function SummaryPlate({ summary, scopeNote, onOpen })
{
    const oldest = summary.oldest_active
    return (
        <Box
            component="section"
            aria-labelledby="summary-heading"
            sx={{ bgcolor: tokens.plate, color: tokens.paper, borderRadius: `${radius.plate}px`, px: { xs: 2.5, md: 4 }, py: { xs: 2.5, md: 3.5 } }}
        >
            <Typography id="summary-heading" variant="h4" component="h2">Right now</Typography>
            <Typography variant="body2" sx={{ color: ON_PLATE_MUTED }}>{scopeNote} Select a number to list those tickets.</Typography>
            <Box
                component="dl"
                sx={{
                    m: 0,
                    mt: 3,
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' },
                    columnGap: 3,
                    rowGap: 2.5,
                }}
            >
                {FIGURES.map((figure) =>
                {
                    const count = figure.count(summary)
                    return (
                        <Figure
                            key={figure.key}
                            label={figure.label}
                            value={count}
                            alarm={figure.alarm}
                            onOpen={() => onOpen({ key: figure.key, label: figure.label, count, query: figure.query })}
                        />
                    )
                })}
            </Box>
            <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid rgba(244, 246, 247, 0.25)' }}>
                {oldest
                    ? (
                        <Typography>
                            Oldest open ticket:{' '}
                            <Link component={RouterLink} to={`/incidents/${oldest.id}`} sx={{ color: tokens.paper, fontWeight: 700 }}>
                                {fmtRef(oldest.id)} {oldest.title}
                            </Link>
                            , reported {fmtAgo(oldest.created_at)}.
                        </Typography>
                    )
                    : <Typography>No open tickets. Everything reported has been fixed.</Typography>}
            </Box>
        </Box>
    )
}
