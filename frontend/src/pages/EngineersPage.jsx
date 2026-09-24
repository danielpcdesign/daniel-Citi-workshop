import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import DashboardSection from '../components/DashboardSection.jsx'
import EngineerPanel from '../components/EngineerPanel.jsx'
import { LIVE_POLL_MS, usePolling } from '../hooks/usePolling.js'
import { listEngineersByWorkload } from '../services/engineerService.js'

// admin only (route guard; the server re-checks): who can take work, and how it is spread (M7)
export default function EngineersPage()
{
    // who can take work changes as tickets move, so it polls like the dashboard and re-reads after every change (AD-14)
    const engineers = usePolling(listEngineersByWorkload, LIVE_POLL_MS)

    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 3 }}>
            <Box>
                <Typography variant="h2" component="h1">Engineers</Typography>
                <Typography color="text.secondary">
                    Who can take new work, and how many tickets each engineer holds. Refreshes every 30 seconds.
                </Typography>
            </Box>
            <DashboardSection
                id="team-heading"
                title="Who's available"
                intro="Least loaded first. Open an engineer to see their tickets."
                state={engineers}
                loadingLabel="Loading engineers"
            >
                {(data) => (
<EngineerPanel engineers={data.items} onChanged={engineers.reload} />
                )}
            </DashboardSection>
        </Box>
    )
}
