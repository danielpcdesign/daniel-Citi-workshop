import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import ErrorNotice from '../components/ErrorNotice.jsx'
import FacilityNode from '../components/FacilityNode.jsx'
import NameForm from '../components/NameForm.jsx'
import PageLoader from '../components/PageLoader.jsx'
import { usePolling } from '../hooks/usePolling.js'
import { createPlace, listBuildings } from '../services/facilityService.js'

// admin only (route guard; the server re-checks writes): the places tickets can be reported against (AD-22)
// read on open and after each change; nothing here changes on its own, so it is not polled (AD-14)
export default function FacilitiesPage()
{
    const buildings = usePolling(listBuildings, null)
    const data = buildings.data
    const add = async (name) =>
    {
        await createPlace('building', null, name)
        await buildings.reload()
    }

    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 3 }}>
            <Box>
                <Typography variant="h2" component="h1">Facilities</Typography>
                <Typography color="text.secondary">
                    Buildings, their floors, and the seats on each floor. These are the places people pick when they report a problem.
                </Typography>
            </Box>
            <Paper variant="outlined" component="section" aria-labelledby="places-heading" sx={{ p: { xs: 2, md: 3 }, display: 'grid', gap: 2 }}>
                <Box>
                    <Typography id="places-heading" variant="h4" component="h2">Places</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Archived places are hidden here; tickets that used them still show their name.
                    </Typography>
                </Box>
                <ErrorNotice
                    error={buildings.error}
                    action={<Button color="inherit" size="small" onClick={buildings.reload}>Try again</Button>}
                />
                {buildings.loading && !data && <PageLoader label="Loading buildings" />}
                {data && data.total === 0 && <Typography>No buildings yet — add the first one.</Typography>}
                {data && data.items.length > 0 && (
                    <Box component="ul" aria-label="Buildings" sx={{ m: 0, p: 0 }}>
                        {data.items.map((building) => (
                            <FacilityNode key={building.id} level="building" place={building} onChanged={buildings.reload} />
                        ))}
                    </Box>
                )}
                {data && data.total > data.items.length && (
                    <Typography variant="body2" color="text.secondary">
                        Showing the first {data.items.length} of {data.total} buildings, by name.
                    </Typography>
                )}
                <NameForm label="New building" submitLabel="Add building" busyLabel="Adding" onSubmit={add} />
            </Paper>
        </Box>
    )
}
