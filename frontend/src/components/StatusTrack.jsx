import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { STEPS, fmtStatus, stepIndex } from '../utils/format.js'
import { tokens } from '../theme.js'

// status by position: the same five places as the stepper, so a list row and the detail view read alike
export default function StatusTrack({ status })
{
    const current = stepIndex(status)
    const blocked = status === 'blocked'
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
                role="img"
                aria-label={`Status: ${fmtStatus(status)}, step ${current + 1} of ${STEPS.length}`}
                sx={{ display: 'flex', gap: '3px' }}
            >
                {STEPS.map((step, index) =>
                {
                    let color = tokens.rule
                    if (index < current || (index === current && !blocked))
                    {
                        color = tokens.plate
                    }
                    else if (index === current && blocked)
                    {
                        color = tokens.signalRed
                    }
                    return <Box key={step} data-filled={color !== tokens.rule} sx={{ width: 18, height: 6, borderRadius: '2px', bgcolor: color }} />
                })}
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 700, color: blocked ? 'error.main' : 'text.primary' }}>
                {fmtStatus(status)}
            </Typography>
        </Box>
    )
}
