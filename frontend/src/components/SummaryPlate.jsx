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

function Figure({ label, value, alarm })
{
    // term before value in the markup, as a description list requires; the number is drawn on top
    return (
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column-reverse', justifyContent: 'flex-end' }}>
            <Typography component="dt" variant="body2" sx={{ mt: 0.75, color: ON_PLATE_MUTED, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                {/* a red mark, not red text: red on the navy plate would fail contrast */}
                {alarm && value > 0 && (
                    <Box component="span" aria-hidden="true" sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: tokens.signalRed, flexShrink: 0 }} />
                )}
                {label}
            </Typography>
            <Typography
                component="dd"
                sx={{ m: 0, fontFamily: 'Overpass, sans-serif', fontWeight: 800, fontSize: { xs: '2rem', md: '2.6rem' }, lineHeight: 1 }}
            >
                {value}
            </Typography>
        </Box>
    )
}

// the dashboard's one bold element: the state of the building's work on a single sign (AD-19 /summary)
export default function SummaryPlate({ summary, scopeNote })
{
    const byStatus = summary.by_status
    const oldest = summary.oldest_active
    return (
        <Box
            component="section"
            aria-labelledby="summary-heading"
            sx={{ bgcolor: tokens.plate, color: tokens.paper, borderRadius: `${radius.plate}px`, px: { xs: 2.5, md: 4 }, py: { xs: 2.5, md: 3.5 } }}
        >
            <Typography id="summary-heading" variant="h4" component="h2">Right now</Typography>
            <Typography variant="body2" sx={{ color: ON_PLATE_MUTED }}>{scopeNote}</Typography>
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
                <Figure label="Open work" value={openWork(byStatus)} />
                <Figure label="Waiting for an engineer" value={byStatus.unassigned} />
                <Figure label="Blocked" value={byStatus.blocked} alarm />
                <Figure label="Escalation requested" value={summary.by_escalation.pending} alarm />
                <Figure label="Fixed, waiting to close" value={byStatus.resolved} />
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
