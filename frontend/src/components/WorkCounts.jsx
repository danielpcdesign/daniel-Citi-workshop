import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { radius, tokens } from '../theme.js'

const ON_PLATE_MUTED = tokens.onPlateMuted

function total(columns, status)
{
    return columns.find((column) => column.status === status)?.total ?? 0
}

// the counts come from the board's own column totals: the summary report counts what the *caller* sees,
// not what one engineer holds, so it cannot be reused here
function workCounts(columns)
{
    const blocked = total(columns, 'blocked')
    return {
        active: total(columns, 'open') + total(columns, 'in_progress') + blocked,
        blocked,
        resolved: total(columns, 'resolved'),
        closed: total(columns, 'closed'),
    }
}

function Figure({ label, value, alarm })
{
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column-reverse', justifyContent: 'flex-end', minWidth: 0 }}>
            <Typography component="dt" variant="body2" sx={{ mt: 0.5, color: ON_PLATE_MUTED, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                {alarm && value > 0 && (
                    <Box component="span" aria-hidden="true" sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: tokens.signalRed, flexShrink: 0 }} />
                )}
                {label}
            </Typography>
            <Typography component="dd" sx={{ m: 0, fontFamily: 'Overpass, sans-serif', fontWeight: 800, fontSize: { xs: '1.75rem', md: '2.1rem' }, lineHeight: 1 }}>
                {value}
            </Typography>
        </Box>
    )
}

// one engineer's load on a smaller copy of the dashboard's plate, so the two read the same way
export default function WorkCounts({ columns })
{
    const counts = workCounts(columns)
    return (
        <Box
            component="dl"
            aria-label="Their tickets in numbers"
            sx={{
                m: 0,
                bgcolor: tokens.plate,
                color: tokens.onPlate,
                borderRadius: `${radius.plate}px`,
                px: { xs: 2.5, md: 3.5 },
                py: { xs: 2, md: 2.5 },
                display: 'grid',
                gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
                columnGap: 3,
                rowGap: 2,
            }}
        >
            <Figure label="Active" value={counts.active} />
            <Figure label="Blocked" value={counts.blocked} alarm />
            <Figure label="Fixed, waiting to close" value={counts.resolved} />
            <Figure label="Closed" value={counts.closed} />
        </Box>
    )
}
