import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { tokens } from '../theme.js'

// a count per label, drawn as a bar against the largest; the number is always written, the bar only helps compare
export default function CountBars({ rows, label, emptyText = 'Nothing to count yet.' })
{
    const largest = Math.max(0, ...rows.map((row) => row.count))
    if (largest === 0)
    {
        return <Typography variant="body2" color="text.secondary">{emptyText}</Typography>
    }
    return (
        <Box component="ul" aria-label={label} sx={{ m: 0, p: 0, display: 'grid', gap: 1 }}>
            {rows.map((row) => (
                <Box component="li" key={row.key} sx={{ listStyle: 'none' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                        <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{row.label}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{row.count}</Typography>
                    </Box>
                    <Box aria-hidden="true" sx={{ mt: 0.5, height: 6, borderRadius: '2px', bgcolor: tokens.rule }}>
                        <Box sx={{ height: '100%', borderRadius: '2px', bgcolor: row.color || tokens.plate, width: `${(row.count / largest) * 100}%` }} />
                    </Box>
                </Box>
            ))}
        </Box>
    )
}
