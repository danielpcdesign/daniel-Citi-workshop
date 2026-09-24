import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import InputAdornment from '@mui/material/InputAdornment'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import SearchIcon from '@mui/icons-material/Search'
import { CATEGORY_LABEL, ESCALATION_LABEL, PRIORITY_LABEL, STATUS_LABEL } from '../utils/format.js'

const ANY = ''

function entries(labels)
{
    return Object.entries(labels).map(([value, label]) => ({ value, label }))
}

const STATUS_OPTIONS = entries(STATUS_LABEL)
const PRIORITY_OPTIONS = ['critical', 'high', 'medium', 'low'].map((value) => ({ value, label: PRIORITY_LABEL[value] }))
const CATEGORY_OPTIONS = entries(CATEGORY_LABEL)
const ESCALATION_OPTIONS = entries(ESCALATION_LABEL)

// a single-choice filter where the empty value means "any"
function Choice({ label, anyLabel, value, options, onChange, helperText, disabled })
{
    return (
        <TextField
            select
            size="small"
            label={label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            helperText={helperText}
            disabled={disabled}
            slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
        >
            <MenuItem value={ANY}>{anyLabel}</MenuItem>
            {options.map((option) => (
                <MenuItem key={option.value} value={String(option.value)}>{option.label}</MenuItem>
            ))}
        </TextField>
    )
}

// every control maps to one server-side filter on GET /api/incidents (AD-13); nothing is filtered in the browser
export default function LookupFilters({ values, onChange, onClear, canClear, isAdmin, buildings, engineers })
{
    const buildingOptions = (buildings.data?.items || []).map((building) => ({ value: building.id, label: building.name }))
    const engineerOptions = (engineers.data?.items || []).map((engineer) => ({ value: engineer.id, label: engineer.full_name }))

    return (
        <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField
                label="Search tickets"
                placeholder="Ticket number, or words from the title or description"
                value={values.text}
                onChange={(event) => onChange('text', event.target.value)}
                slotProps={{
                    htmlInput: { type: 'search', enterKeyHint: 'search' },
                    input: { startAdornment: <InputAdornment position="start"><SearchIcon aria-hidden="true" /></InputAdornment> },
                }}
            />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
                <TextField
                    select
                    size="small"
                    label="Status"
                    value={values.statuses}
                    onChange={(event) => onChange('statuses', event.target.value)}
                    slotProps={{
                        inputLabel: { shrink: true },
                        select: {
                            multiple: true,
                            displayEmpty: true,
                            renderValue: (selected) => (selected.length ? selected.map((status) => STATUS_LABEL[status]).join(', ') : 'Any status'),
                        },
                    }}
                >
                    {STATUS_OPTIONS.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                            <Checkbox size="small" checked={values.statuses.includes(option.value)} sx={{ p: 0, mr: 1 }} />
                            <ListItemText primary={option.label} />
                        </MenuItem>
                    ))}
                </TextField>
                <Choice label="Priority" anyLabel="Any priority" value={values.priority} options={PRIORITY_OPTIONS} onChange={(value) => onChange('priority', value)} />
                <Choice label="Kind of problem" anyLabel="Any kind" value={values.category} options={CATEGORY_OPTIONS} onChange={(value) => onChange('category', value)} />
                <Choice
                    label="Building"
                    anyLabel="Any building"
                    value={values.buildingId}
                    options={buildingOptions}
                    onChange={(value) => onChange('buildingId', value)}
                    helperText={buildings.error ? 'Buildings could not be loaded.' : undefined}
                />
                {isAdmin && (
                    <Choice
                        label="Engineer"
                        anyLabel="Any engineer"
                        value={values.assigneeId}
                        options={engineerOptions}
                        onChange={(value) => onChange('assigneeId', value)}
                        helperText={engineers.error ? 'Engineers could not be loaded.' : undefined}
                    />
                )}
                <Choice label="Escalation" anyLabel="Any escalation" value={values.escalation} options={ESCALATION_OPTIONS} onChange={(value) => onChange('escalation', value)} />
            </Box>
            <Box>
                <Button variant="outlined" size="small" onClick={onClear} disabled={!canClear}>Clear filters</Button>
            </Box>
        </Box>
    )
}
