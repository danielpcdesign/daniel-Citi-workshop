import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import ErrorNotice from './ErrorNotice.jsx'
import PageLoader from './PageLoader.jsx'

// one report on the dashboard with its own loading and failure states, so one slow or failed report never blanks the rest
export default function DashboardSection({ id, title, intro, action, state, loadingLabel, children })
{
    const { data, error, loading, reload } = state
    return (
        <Paper variant="outlined" component="section" aria-labelledby={id} sx={{ p: { xs: 2, md: 3 } }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 2 }}>
                <Box sx={{ minWidth: 0 }}>
                    <Typography id={id} variant="h4" component="h2">{title}</Typography>
                    {intro && <Typography variant="body2" color="text.secondary">{intro}</Typography>}
                </Box>
                {action}
            </Box>
            <ErrorNotice
                error={error}
                sx={{ mb: 2 }}
                action={<Button color="inherit" size="small" onClick={reload}>Try again</Button>}
            />
            {loading && !data && <PageLoader label={loadingLabel} />}
            {data && children(data)}
        </Paper>
    )
}
