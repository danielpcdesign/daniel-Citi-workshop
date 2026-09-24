import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import CountBars from './CountBars.jsx'

const TOP = 5

function placeName(place)
{
    return place.archived ? `${place.name} (archived)` : place.name
}

// floors and seats carry only a parent id; the parent's name is used when it is in the same answer (backend gap, reported)
function withParent(place, parents)
{
    const parent = parents.find((candidate) => candidate.id === place.parent_id)
    return parent ? `${placeName(parent)}, ${placeName(place)}` : placeName(place)
}

// where problems recur: the most-reported places at each level, archived ones included (AD-19 /hotspots)
export default function HotspotList({ hotspots })
{
    const levels = [
        { key: 'buildings', title: 'Buildings', rows: hotspots.buildings.map((place) => ({ ...place, label: placeName(place) })) },
        { key: 'floors', title: 'Floors', rows: hotspots.floors.map((place) => ({ ...place, label: withParent(place, hotspots.buildings) })) },
        { key: 'seats', title: 'Seats', rows: hotspots.seats.map((place) => ({ ...place, label: withParent(place, hotspots.floors) })) },
    ]
    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 3 }}>
            {levels.map((level) => (
                <Box key={level.key} sx={{ minWidth: 0 }}>
                    <Typography variant="h6" component="h3" sx={{ mb: 1 }}>{level.title}</Typography>
                    <CountBars
                        label={`Incidents by ${level.key}`}
                        rows={level.rows.slice(0, TOP).map((place) => ({ key: place.id, label: place.label, count: place.incidents }))}
                        emptyText="No incidents recorded here yet."
                    />
                </Box>
            ))}
        </Box>
    )
}
