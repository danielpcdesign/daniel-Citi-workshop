import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import StatusTrack from './StatusTrack.jsx'
import { fmtAgo, fmtLocation, fmtRef, nextStep } from '../utils/format.js'
import { tokens } from '../theme.js'

export default function TicketRow({ incident })
{
    return (
        <Box
            component="li"
            sx={{ listStyle: 'none', borderBottom: `1px solid ${tokens.rule}`, '&:last-of-type': { borderBottom: 0 } }}
        >
            <Box
                component={RouterLink}
                to={`/incidents/${incident.id}`}
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: '1fr 220px' },
                    gap: { xs: 1, md: 3 },
                    px: { xs: 2, md: 3 },
                    py: 2,
                    color: 'inherit',
                    textDecoration: 'none',
                    '&:hover .ticket-title': { textDecoration: 'underline' },
                }}
            >
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" component="h2" className="ticket-title">
                        <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>{fmtRef(incident.id)}</Box>
                        {incident.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">{fmtLocation(incident.location)}</Typography>
                    <Typography variant="body2" sx={{ mt: 0.75 }}>{nextStep(incident)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: { md: 'flex-end' } }}>
                    <StatusTrack status={incident.status} />
                    <Typography variant="caption" color="text.secondary">
                        Updated {fmtAgo(incident.updated_at)}
                    </Typography>
                </Box>
            </Box>
        </Box>
    )
}
