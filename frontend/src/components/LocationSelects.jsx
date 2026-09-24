import { useEffect, useState } from 'react'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { listBuildings, listFloors, listSeats } from '../services/facilityService.js'

const NONE = ''

// loads one level's options whenever its parent changes; null parent means "nothing to load"
function useOptions(load, parentId)
{
    const [state, setState] = useState({ items: [], error: null, loadedFor: undefined })

    useEffect(() =>
    {
        if (parentId === null)
        {
            return undefined
        }
        let active = true
        load(parentId)
            .then((page) =>
            {
                if (active)
                {
                    setState({ items: page.items, error: null, loadedFor: parentId })
                }
            })
            .catch((error) =>
            {
                if (active)
                {
                    setState({ items: [], error, loadedFor: parentId })
                }
            })
        return () =>
        {
            active = false
        }
    }, [load, parentId])

    // options from a previous parent are never shown under a new one
    const current = parentId !== null && state.loadedFor === parentId
    return {
        items: current ? state.items : [],
        error: current ? state.error : null,
        loading: parentId !== null && !current,
    }
}

const loadBuildings = () => listBuildings()

// building is required, floor and seat optional: a lobby leak has no seat (AD-22)
export default function LocationSelects({ value, onChange, errors = {}, disabled })
{
    const buildings = useOptions(loadBuildings, 'all')
    const floors = useOptions(listFloors, value.buildingId || null)
    const seats = useOptions(listSeats, value.floorId || null)

    const loadProblem = buildings.error || floors.error || seats.error

    return (
        <Stack spacing={2.5}>
            <TextField
                select
                label="Building"
                value={value.buildingId}
                onChange={(event) => onChange({ buildingId: event.target.value, floorId: NONE, seatId: NONE })}
                error={Boolean(errors.building_id || loadProblem)}
                helperText={errors.building_id || (loadProblem ? 'Could not load places. Reload the page to try again.' : null)}
                disabled={disabled || buildings.loading}
                required
            >
                {buildings.items.map((building) => (
                    <MenuItem key={building.id} value={building.id}>{building.name}</MenuItem>
                ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                    select
                    fullWidth
                    label="Floor (optional)"
                    value={value.floorId}
                    onChange={(event) => onChange({ ...value, floorId: event.target.value, seatId: NONE })}
                    error={Boolean(errors.floor_id)}
                    helperText={errors.floor_id || (value.buildingId && !floors.loading && floors.items.length === 0 ? 'This building has no floors listed.' : null)}
                    disabled={disabled || !value.buildingId || floors.items.length === 0}
                >
                    <MenuItem value={NONE}>Not on a particular floor</MenuItem>
                    {floors.items.map((floor) => (
                        <MenuItem key={floor.id} value={floor.id}>{floor.name}</MenuItem>
                    ))}
                </TextField>
                <TextField
                    select
                    fullWidth
                    label="Seat (optional)"
                    value={value.seatId}
                    onChange={(event) => onChange({ ...value, seatId: event.target.value })}
                    error={Boolean(errors.seat_id)}
                    helperText={errors.seat_id}
                    disabled={disabled || !value.floorId || seats.items.length === 0}
                >
                    <MenuItem value={NONE}>Not at a particular seat</MenuItem>
                    {seats.items.map((seat) => (
                        <MenuItem key={seat.id} value={seat.id}>{seat.name}</MenuItem>
                    ))}
                </TextField>
            </Stack>
        </Stack>
    )
}
