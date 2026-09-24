import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { fmtDuration } from '../utils/format.js'
import { tokens } from '../theme.js'

// a real sequence, all measured from when the ticket was reported, so the three read as one timeline (AD-19 /timings)
const STAGES = [
    { key: 'time_to_assign', label: 'Engineer assigned' },
    { key: 'time_to_acknowledge', label: 'Work started' },
    { key: 'time_to_resolve', label: 'Fixed' },
]

export default function TimingTrack({ timings })
{
    return (
        <Box component="ol" aria-label="Typical time after a ticket is reported" sx={{ m: 0, p: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
            {STAGES.map((stage) =>
            {
                const stat = timings[stage.key]
                return (
                    <Box component="li" key={stage.key} sx={{ listStyle: 'none', borderTop: `4px solid ${tokens.plate}`, pt: 1.25 }}>
                        <Typography variant="body2" color="text.secondary">{stage.label}</Typography>
                        <Typography variant="h4" component="p" sx={{ mt: 0.25 }}>{fmtDuration(stat.median_seconds)}</Typography>
                        {stat.count > 0 && (
                            <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 0.5 }}>
                                Median of {stat.count} {stat.count === 1 ? 'ticket' : 'tickets'}; average {fmtDuration(stat.average_seconds)}
                            </Typography>
                        )}
                    </Box>
                )
            })}
        </Box>
    )
}
