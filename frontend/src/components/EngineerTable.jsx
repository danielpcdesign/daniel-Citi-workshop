import { useMediaQuery } from 'react-responsive'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { MOBILE_QUERY } from './AppShell.jsx'
import { srOnly, tokens } from '../theme.js'

// the count is the fact; the bar only makes the spread across engineers visible at a glance
function Workload({ count, most })
{
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography component="span" sx={{ fontWeight: 700, minWidth: '2ch', textAlign: 'right' }}>{count}</Typography>
            <Box aria-hidden="true" sx={{ flex: 1, maxWidth: 120, height: 6, borderRadius: '2px', bgcolor: tokens.rule }}>
                <Box sx={{ width: `${(count / most) * 100}%`, height: '100%', borderRadius: '2px', bgcolor: tokens.plate }} />
            </Box>
        </Box>
    )
}

function AvailabilitySwitch({ engineer, pending, onToggle })
{
    return (
        <FormControlLabel
            sx={{ m: 0 }}
            control={(
                <Switch
                    checked={engineer.is_available}
                    disabled={pending}
                    onChange={(event) => onToggle(engineer, event.target.checked)}
                    slotProps={{ input: { 'aria-label': `${engineer.full_name} takes new tickets` } }}
                />
            )}
            label={engineer.is_available ? 'Available' : 'Not taking new work'}
        />
    )
}

// least loaded first, as the server sorted them; a phone gets one card per engineer instead of four columns
export default function EngineerTable({ engineers, pendingId, onToggle, onDemote })
{
    const isMobile = useMediaQuery({ query: MOBILE_QUERY })
    const most = Math.max(1, ...engineers.map((engineer) => engineer.workload))

    if (isMobile)
    {
        return (
            <Box component="ul" aria-label="Engineers" sx={{ m: 0, p: 0 }}>
                {engineers.map((engineer) => (
                    <Box component="li" key={engineer.id} sx={{ listStyle: 'none', py: 1.5, borderTop: `1px solid ${tokens.rule}` }}>
                        <Typography variant="h6" component="p">{engineer.full_name}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{engineer.email}</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                            <Typography variant="body2">Active tickets</Typography>
                            <Box sx={{ flex: 1 }}><Workload count={engineer.workload} most={most} /></Box>
                        </Box>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 0.5 }}>
                            <AvailabilitySwitch engineer={engineer} pending={pendingId === engineer.id} onToggle={onToggle} />
                            <Button size="small" color="error" onClick={() => onDemote(engineer)} aria-label={`Demote ${engineer.full_name}`}>Demote</Button>
                        </Box>
                    </Box>
                ))}
            </Box>
        )
    }

    return (
        <Table size="small" aria-label="Engineers">
            <TableHead>
                <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Availability</TableCell>
                    <TableCell>Active tickets</TableCell>
                    <TableCell><Box component="span" sx={srOnly}>Actions</Box></TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {engineers.map((engineer) => (
                    <TableRow key={engineer.id}>
                        <TableCell sx={{ fontWeight: 700 }}>{engineer.full_name}</TableCell>
                        <TableCell sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{engineer.email}</TableCell>
                        <TableCell>
                            <AvailabilitySwitch engineer={engineer} pending={pendingId === engineer.id} onToggle={onToggle} />
                        </TableCell>
                        <TableCell sx={{ minWidth: 140 }}><Workload count={engineer.workload} most={most} /></TableCell>
                        <TableCell align="right">
                            <Button size="small" color="error" onClick={() => onDemote(engineer)} aria-label={`Demote ${engineer.full_name}`}>
                                Demote
                            </Button>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    )
}
