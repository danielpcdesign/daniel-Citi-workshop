import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Typography from '@mui/material/Typography'
import ErrorNotice from '../components/ErrorNotice.jsx'
import StatusTrack from '../components/StatusTrack.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { useSettings } from '../hooks/useSettings.js'
import { PRIORITY_LABEL } from '../utils/format.js'
import { ROLE_LABEL, ROLE_ORDER, heldRoles, homePath } from '../utils/roles.js'
import { tokens } from '../theme.js'

// one titled group of choices; the radio group is named by the heading, described by the hint
function Choice({ title, hint, value, options, onChange, disabled, children })
{
    const headingId = useId()
    const hintId = useId()
    return (
        <Paper variant="outlined" component="section" aria-labelledby={headingId} sx={{ p: { xs: 2, md: 3 } }}>
            <Typography id={headingId} variant="h4" component="h2">{title}</Typography>
            {hint && <Typography id={hintId} variant="body2" color="text.secondary" sx={{ mb: 1 }}>{hint}</Typography>}
            <RadioGroup
                aria-labelledby={headingId}
                aria-describedby={hint ? hintId : undefined}
                value={value}
                onChange={(event) => onChange(event.target.value)}
            >
                {options.map((option) => (
                    <FormControlLabel key={option.value} value={option.value} control={<Radio />} label={option.label} disabled={disabled} />
                ))}
            </RadioGroup>
            {children}
        </Paper>
    )
}

// the palette at work: a status and two priorities, each carried by a word as well as a colour
function ColourPreview()
{
    const mark = (color) => <Box component="span" aria-hidden="true" sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: color, flexShrink: 0 }} />
    return (
        <Box
            aria-label="Preview"
            role="group"
            sx={{ mt: 1.5, p: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3, border: `1px dashed ${tokens.rule}`, borderRadius: 1 }}
        >
            <StatusTrack status="blocked" />
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontWeight: 700, color: tokens.signalRed }}>
                {mark(tokens.signalRed)}{PRIORITY_LABEL.critical}
            </Box>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontWeight: 700, color: tokens.signalAmber }}>
                {mark(tokens.signalAmber)}{PRIORITY_LABEL.high}
            </Box>
        </Box>
    )
}

// which of the held roles to act in; the server re-issues the session for it (POST /auth/active-role)
function RoleChoice()
{
    const { user, switchRole } = useAuth()
    const navigate = useNavigate()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const roles = ROLE_ORDER.filter((role) => heldRoles(user).includes(role))

    if (roles.length < 2)
    {
        return null
    }

    const change = async (role) =>
    {
        setBusy(true)
        setError(null)
        try
        {
            const next = await switchRole(role)
            // each role starts somewhere different; a fresh page also drops anything loaded for the old role
            navigate(homePath(next))
        }
        catch (failure)
        {
            setError(failure)
            setBusy(false)
        }
    }

    return (
        <Choice
            title="Viewing as"
            hint="You hold more than one role. Pick the one to work in; pages, menus and permissions follow it."
            value={user.role}
            options={roles.map((role) => ({ value: role, label: ROLE_LABEL[role] }))}
            onChange={change}
            disabled={busy}
        >
            <ErrorNotice error={error} sx={{ mt: 1 }} />
        </Choice>
    )
}

// this device's settings, applied at once; nothing here is stored on the account
export default function SettingsPage()
{
    const { settings, update, persisted, mode, reducedMotion } = useSettings()

    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 3, maxWidth: 720 }}>
            <Box>
                <Typography variant="h2" component="h1">Settings</Typography>
                <Typography color="text.secondary">Changes apply straight away and are kept on this device.</Typography>
            </Box>

            {!persisted && (
                <Alert severity="info">
                    This browser is not keeping settings, so these apply until the tab is closed.
                </Alert>
            )}

            <RoleChoice />

            <Choice
                title="Appearance"
                hint={settings.appearance === 'system' ? `Following your device, which is set to ${mode} right now.` : undefined}
                value={settings.appearance}
                options={[
                    { value: 'system', label: 'Match my device' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                ]}
                onChange={(appearance) => update({ appearance })}
            />

            <Choice
                title="Status colours"
                hint="The colour-blind safe set uses vermillion and blue (Okabe–Ito), which stay apart with every common kind of colour blindness. Every colour also comes with a word."
                value={settings.palette}
                options={[
                    { value: 'standard', label: 'Standard' },
                    { value: 'safe', label: 'Colour-blind safe' },
                ]}
                onChange={(palette) => update({ palette })}
            >
                <ColourPreview />
            </Choice>

            <Choice
                title="Motion"
                hint={settings.motion === 'system' ? `Following your device, which ${reducedMotion ? 'asks for less motion' : 'allows motion'}.` : undefined}
                value={settings.motion}
                options={[
                    { value: 'system', label: 'Match my device' },
                    { value: 'reduce', label: 'Reduce motion' },
                    { value: 'full', label: 'Allow motion' },
                ]}
                onChange={(motion) => update({ motion })}
            />
        </Box>
    )
}
