import { useEffect, useMemo, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { SettingsContext } from '../hooks/settingsContext.js'
import { loadSettings, saveSettings } from '../utils/settings.js'
import { buildTheme } from '../theme.js'

// turns the stored choices, and the system's own preferences where a choice says "follow the system", into the theme;
// a change applies at once: the theme is rebuilt and re-provided, no reload
export default function SettingsProvider({ children })
{
    const [settings, setSettings] = useState(loadSettings)
    const [persisted, setPersisted] = useState(true)
    const prefersDark = useMediaQuery({ query: '(prefers-color-scheme: dark)' })
    const prefersReduced = useMediaQuery({ query: '(prefers-reduced-motion: reduce)' })

    const mode = settings.appearance === 'system' ? (prefersDark ? 'dark' : 'light') : settings.appearance
    const reducedMotion = settings.motion === 'system' ? prefersReduced : settings.motion === 'reduce'
    const theme = useMemo(() => buildTheme({ mode, palette: settings.palette, reducedMotion }), [mode, settings.palette, reducedMotion])

    // for code outside React's tree (scrolling to a section) that must also respect the choice
    useEffect(() =>
    {
        document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'full'
    }, [reducedMotion])

    const value = useMemo(() => ({
        settings,
        persisted,
        mode,
        reducedMotion,
        update: (patch) =>
        {
            const next = { ...settings, ...patch }
            setSettings(next)
            setPersisted(saveSettings(next))
        },
    }), [settings, persisted, mode, reducedMotion])

    return (
        <SettingsContext.Provider value={value}>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                {children}
            </ThemeProvider>
        </SettingsContext.Provider>
    )
}
