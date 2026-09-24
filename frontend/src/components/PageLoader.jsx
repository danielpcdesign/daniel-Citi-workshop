import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'

export default function PageLoader({ label = 'Loading' })
{
    return (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 6, justifyContent: 'center' }}>
            <CircularProgress size={24} aria-hidden="true" />
            <span>{label}</span>
        </Box>
    )
}
