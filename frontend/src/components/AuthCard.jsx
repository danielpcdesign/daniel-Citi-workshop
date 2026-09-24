import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'

export default function AuthCard({ title, intro, children })
{
    return (
        <Box sx={{ maxWidth: 440, mx: 'auto', mt: { xs: 2, md: 6 } }}>
            <Typography variant="h2" component="h1" sx={{ mb: 1 }}>{title}</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>{intro}</Typography>
            <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 } }}>
                {children}
            </Paper>
        </Box>
    )
}
