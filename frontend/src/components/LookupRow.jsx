import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import ScheduleIcon from '@mui/icons-material/Schedule'
import { PRIORITY_LABEL, fmtAgo, fmtLocation, fmtRef, fmtStatus } from '../utils/format.js'
import { srOnly, tokens } from '../theme.js'

// red and amber keep their meaning from the rest of the app: urgent, not decoration
const PRIORITY_MARK = { critical: tokens.signalRed, high: tokens.signalAmber }

// an icon for sighted readers, a word for screen readers; no separators to parse
function Fact({ icon, label, children })
{
    return (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            {icon}
            <Box component="span" sx={srOnly}>{label}: </Box>
            {children}
        </Box>
    )
}

const iconSx = { fontSize: 16, color: tokens.muted }

// one result: the row selects the ticket for the history panel; "Open" leaves for the full page
export default function LookupRow({ incident, selected, onSelect })
{
    const blocked = incident.status === 'blocked'
    const mark = PRIORITY_MARK[incident.priority]
    return (
        <Box
            component="li"
            sx={{
                listStyle: 'none',
                display: 'flex',
                alignItems: 'stretch',
                borderBottom: `1px solid ${tokens.rule}`,
                '&:last-of-type': { borderBottom: 0 },
                bgcolor: selected ? tokens.tint : 'transparent',
                // the selected row is marked by position too, not by tint alone
                boxShadow: selected ? `inset 4px 0 0 ${tokens.mark}` : 'none',
            }}
        >
            <ButtonBase
                aria-pressed={selected}
                onClick={() => onSelect(incident)}
                sx={{
                    flex: 1,
                    minWidth: 0,
                    display: 'block',
                    textAlign: 'left',
                    px: 2,
                    py: 1.5,
                    '&:hover': { bgcolor: selected ? 'transparent' : tokens.tintSoft },
                    '&:hover .lookup-title': { textDecoration: 'underline' },
                }}
            >
                <Typography component="span" variant="h6" className="lookup-title" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                    <Box component="span" sx={{ color: 'text.secondary' }}>{fmtRef(incident.id)}</Box>
                    {' '}{incident.title}
                </Typography>
                <Typography
                    component="span"
                    variant="body2"
                    sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 0.25, mt: 0.5 }}
                >
                    <Box component="span" sx={{ fontWeight: 700, color: blocked ? 'error.main' : 'text.primary' }}>
                        {fmtStatus(incident.status)}
                    </Box>
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                        <Box
                            component="span"
                            aria-hidden="true"
                            sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: mark || tokens.rule }}
                        />
                        {PRIORITY_LABEL[incident.priority]} priority
                    </Box>
                    <Fact icon={<PlaceOutlinedIcon aria-hidden="true" sx={iconSx} />} label="Location">
                        {fmtLocation(incident.location)}
                    </Fact>
                    <Fact icon={<PersonOutlineIcon aria-hidden="true" sx={iconSx} />} label="Engineer">
                        {incident.assignee_name || 'No engineer yet'}
                    </Fact>
                    <Fact icon={<ScheduleIcon aria-hidden="true" sx={iconSx} />} label="Age">
                        Reported {fmtAgo(incident.created_at)}
                    </Fact>
                </Typography>
            </ButtonBase>
            <Link
                component={RouterLink}
                to={`/incidents/${incident.id}`}
                aria-label={`Open ${fmtRef(incident.id)} ${incident.title}`}
                sx={{ alignSelf: 'center', px: 2, py: 1, fontWeight: 700, flexShrink: 0 }}
            >
                Open
            </Link>
        </Box>
    )
}
