import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'

// the label says the state in words, so the switch never relies on its colour (the engineer list and the profile)
export default function AvailabilitySwitch({ engineer, pending, onToggle })
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
