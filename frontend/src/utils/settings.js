// device settings: they describe this screen and its viewer, so they live in this browser, not on the account
const KEY = 'acme.settings'

export const DEFAULT_SETTINGS = { appearance: 'system', palette: 'standard', motion: 'system' }

const ALLOWED = {
    appearance: ['system', 'light', 'dark'],
    palette: ['standard', 'safe'],
    motion: ['system', 'reduce', 'full'],
}

// anything unknown (an older version, a hand edit) falls back to the default for that setting alone
export function cleanSettings(raw)
{
    const source = raw && typeof raw === 'object' ? raw : {}
    return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([name, fallback]) => (
        [name, ALLOWED[name].includes(source[name]) ? source[name] : fallback]
    )))
}

// storage can be missing, full, or blocked (private windows, strict policies): the app then runs on defaults
export function loadSettings()
{
    try
    {
        const stored = window.localStorage.getItem(KEY)
        return cleanSettings(stored ? JSON.parse(stored) : null)
    }
    catch
    {
        return { ...DEFAULT_SETTINGS }
    }
}

// true when the choice will survive a reload; the page says so when it will not
export function saveSettings(settings)
{
    try
    {
        window.localStorage.setItem(KEY, JSON.stringify(cleanSettings(settings)))
        return true
    }
    catch
    {
        return false
    }
}
