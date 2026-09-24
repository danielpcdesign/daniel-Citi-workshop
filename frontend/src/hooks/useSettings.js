import { useContext } from 'react'
import { SettingsContext } from './settingsContext.js'

export function useSettings()
{
    const settings = useContext(SettingsContext)
    if (!settings)
    {
        throw new Error('useSettings must be used inside <SettingsProvider>')
    }
    return settings
}
