import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import BoardCard from './BoardCard.jsx'
import { fmtStatus } from '../utils/format.js'
import { radius, srOnly, tokens } from '../theme.js'

// one status; the count is the server's total, so it stays true when only the first few cards are shown (AD-13)
export default function BoardColumn({ status, items, total })
{
    const blocked = status === 'blocked'
    const headingId = `board-${status}`
    const hidden = total - items.length
    return (
        <Box
            component="section"
            aria-labelledby={headingId}
            data-status={status}
            sx={{
                bgcolor: blocked ? 'rgba(180, 35, 24, 0.06)' : 'rgba(31, 58, 77, 0.04)',
                borderTop: `4px solid ${blocked ? tokens.signalRed : tokens.plate}`,
                borderRadius: `${radius.surface}px`,
                p: 1.25,
                minWidth: 0,
                scrollSnapAlign: 'start',
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, px: 0.25, mb: 1.25 }}>
                <Typography id={headingId} variant="h6" component="h3" sx={{ color: blocked ? 'error.main' : 'text.primary' }}>
                    {fmtStatus(status)}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {total}
                    <Box component="span" sx={srOnly}> tickets</Box>
                </Typography>
            </Box>
            {items.length === 0
                ? <Typography variant="body2" color="text.secondary" sx={{ px: 0.25 }}>None</Typography>
                : (
                    <Box component="ul" sx={{ m: 0, p: 0, display: 'grid', gap: 1 }}>
                        {items.map((incident) => <BoardCard key={incident.id} incident={incident} blocked={blocked} />)}
                    </Box>
                )}
            {hidden > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, px: 0.25 }}>
                    +{hidden} more not shown
                </Typography>
            )}
        </Box>
    )
}
