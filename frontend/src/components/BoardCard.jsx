import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { ESCALATION_LABEL, PRIORITY_LABEL, fmtAgo, fmtLocation, fmtRef } from '../utils/format.js'
import { radius, tokens } from '../theme.js'

// signal colours carry meaning only: red for critical, amber for high, nothing for the rest
const PRIORITY_COLOR = { critical: tokens.signalRed, high: tokens.signalAmber }

// one ticket on the board; a link, not a drag handle: moves go through the ticket's own buttons (AD-18)
export default function BoardCard({ incident, blocked })
{
    const escalated = incident.escalation_status === 'pending' || incident.escalation_status === 'granted'
    return (
        <Box component="li" sx={{ listStyle: 'none' }}>
            <Box
                component={RouterLink}
                to={`/incidents/${incident.id}`}
                sx={{
                    display: 'block',
                    p: 1.5,
                    bgcolor: 'background.paper',
                    color: 'inherit',
                    textDecoration: 'none',
                    border: `1px solid ${tokens.rule}`,
                    borderLeft: `4px solid ${blocked ? tokens.signalRed : tokens.rule}`,
                    borderRadius: `${radius.control}px`,
                    '&:hover .card-title': { textDecoration: 'underline' },
                }}
            >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary">{fmtRef(incident.id)}</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: PRIORITY_COLOR[incident.priority] || 'text.secondary' }}>
                        {PRIORITY_LABEL[incident.priority]}
                    </Typography>
                </Box>
                <Typography className="card-title" sx={{ fontWeight: 700, lineHeight: 1.3, mt: 0.25, overflowWrap: 'anywhere' }}>
                    {incident.title}
                </Typography>
                <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 0.5 }}>
                    {fmtLocation(incident.location)}
                </Typography>
                <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
                    {incident.assignee_name || 'No engineer yet'}, reported {fmtAgo(incident.created_at)}
                </Typography>
                {escalated && (
                    <Typography variant="caption" component="p" sx={{ mt: 0.5, fontWeight: 700, color: tokens.signalAmber }}>
                        {ESCALATION_LABEL[incident.escalation_status]}
                    </Typography>
                )}
            </Box>
        </Box>
    )
}
