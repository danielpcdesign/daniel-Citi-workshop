import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { CATEGORY_LABEL, ESCALATION_LABEL, PRIORITY_LABEL, fmtDateTime, fmtLocation, fmtRef, anyArchived } from '../utils/format.js'
import { radius, tokens } from '../theme.js'

function Fact({ label, children })
{
    return (
        <Box>
            <Typography component="dt" variant="caption" sx={{ color: 'rgba(244, 246, 247, 0.72)' }}>{label}</Typography>
            <Typography component="dd" sx={{ m: 0, fontWeight: 700 }}>{children}</Typography>
        </Box>
    )
}

// the one bold element: the ticket's identity plate, like a sign on a door (design plan)
export default function IncidentPlate({ incident })
{
    const priorityChanged = incident.priority !== incident.requested_priority
    return (
        <Box
            component="header"
            sx={{
                bgcolor: tokens.plate,
                color: tokens.paper,
                borderRadius: `${radius.plate}px`,
                px: { xs: 2.5, md: 4 },
                py: { xs: 2.5, md: 3.5 },
            }}
        >
            <Typography
                sx={{ fontFamily: 'Overpass, sans-serif', fontWeight: 800, fontSize: { xs: '2.2rem', md: '3.2rem' }, lineHeight: 1 }}
            >
                {fmtRef(incident.id)}
            </Typography>
            <Typography variant="h2" component="h1" sx={{ mt: 1, fontSize: { xs: '1.5rem', md: '1.95rem' } }}>
                {incident.title}
            </Typography>
            <Typography sx={{ mt: 1 }}>
                {fmtLocation(incident.location)}
            </Typography>
            {anyArchived(incident.location) && (
                <Typography variant="body2" sx={{ color: 'rgba(244, 246, 247, 0.8)' }}>
                    Part of this location has since been removed from the facility list.
                </Typography>
            )}
            <Box
                component="dl"
                sx={{
                    m: 0,
                    mt: 3,
                    pt: 2,
                    borderTop: '1px solid rgba(244, 246, 247, 0.25)',
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, auto)' },
                    justifyContent: 'start',
                    columnGap: 5,
                    rowGap: 1.5,
                }}
            >
                <Fact label="Reported by">{incident.reporter_name}, {fmtDateTime(incident.created_at)}</Fact>
                <Fact label="Engineer">{incident.assignee_name || 'Not assigned yet'}</Fact>
                <Fact label="Priority">
                    {PRIORITY_LABEL[incident.priority]}
                    {priorityChanged && ` (asked for ${PRIORITY_LABEL[incident.requested_priority]})`}
                </Fact>
                <Fact label="Kind of problem">{CATEGORY_LABEL[incident.category] || incident.category}</Fact>
                {incident.escalation_status !== 'none' && (
                    <Fact label="Escalation">{ESCALATION_LABEL[incident.escalation_status]}</Fact>
                )}
            </Box>
        </Box>
    )
}
