import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { ESCALATION_LABEL, fmtAgo, fmtRef } from '../utils/format.js'
import { tokens } from '../theme.js'

function Entry({ id, title, children })
{
    return (
        <Box component="li" sx={{ listStyle: 'none', py: 1.5, borderTop: `1px solid ${tokens.rule}` }}>
            <Link component={RouterLink} to={`/incidents/${id}`} sx={{ fontWeight: 700 }}>
                {fmtRef(id)} {title}
            </Link>
            {children}
        </Box>
    )
}

function Group({ id, title, count, children, emptyText })
{
    return (
        <Box sx={{ minWidth: 0 }}>
            <Typography id={id} variant="h6" component="h3" sx={{ mb: 0.5 }}>
                {title} <Box component="span" sx={{ color: 'text.secondary' }}>({count})</Box>
            </Typography>
            {count === 0
                ? <Typography variant="body2" color="text.secondary">{emptyText}</Typography>
                : <Box component="ul" aria-labelledby={id} sx={{ m: 0, p: 0 }}>{children}</Box>}
        </Box>
    )
}

// the "which incidents are escalated or blocked, and why" question, answered with the recorded reasons (AD-19 /attention)
export default function AttentionList({ attention })
{
    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 3, md: 4 } }}>
            <Group id="attention-blocked" title="Blocked" count={attention.blocked.length} emptyText="Nothing is blocked.">
                {attention.blocked.map((item) => (
                    <Entry key={item.id} id={item.id} title={item.title}>
                        <Typography variant="body2" sx={{ mt: 0.5 }}>{item.reason || 'No reason recorded'}</Typography>
                        <Typography variant="caption" color="text.secondary">
                            {item.assignee_name || 'No engineer'}, blocked {fmtAgo(item.blocked_since)}
                        </Typography>
                    </Entry>
                ))}
            </Group>
            <Group id="attention-escalated" title="Escalations" count={attention.escalated.length} emptyText="No escalation requests are waiting.">
                {attention.escalated.map((item) => (
                    <Entry key={item.id} id={item.id} title={item.title}>
                        <Typography
                            variant="body2"
                            sx={{ mt: 0.5, fontWeight: 700, color: item.escalation_status === 'pending' ? tokens.signalAmber : 'text.primary' }}
                        >
                            {item.escalation_status === 'pending' ? 'Waiting for your decision' : ESCALATION_LABEL[item.escalation_status]}
                        </Typography>
                        <Typography variant="body2">{item.reason || 'The reporter removed their reason.'}</Typography>
                        {item.requested_at && (
                            <Typography variant="caption" color="text.secondary">Requested {fmtAgo(item.requested_at)}</Typography>
                        )}
                    </Entry>
                ))}
            </Group>
        </Box>
    )
}
