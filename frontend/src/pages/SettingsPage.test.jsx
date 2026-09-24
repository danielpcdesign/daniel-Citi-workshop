import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTheme } from '@mui/material/styles'
import SettingsPage from './SettingsPage.jsx'
import BoardColumn from '../components/BoardColumn.jsx'
import SettingsProvider from '../components/SettingsProvider.jsx'
import { useSettings } from '../hooks/useSettings.js'
import { ApiError } from '../services/http.js'
import { ADMIN, EMPLOYEE, fakeAuth, incidentFixture, renderPage } from '../test/render.jsx'
import { scrollToSection } from '../utils/scroll.js'
import { tokens } from '../theme.js'

// what the provider hands down: the theme every component styles itself with
function ThemeProbe()
{
    const theme = useTheme()
    return (
        <p data-testid="theme">
            {theme.palette.mode} {theme.acme.palette} {theme.acme.status.blocked} {theme.transitions.create('opacity')}
        </p>
    )
}

// the css variables the provider writes on :root, read from the page's own stylesheets
function rootVariable(name)
{
    const css = [...document.querySelectorAll('style')].map((style) => style.textContent).join('\n')
    const matches = [...css.matchAll(new RegExp(`--acme-${name}:([^;}]+)`, 'g'))]
    return matches.length ? matches[matches.length - 1][1].trim() : null
}

// the css rules written for an element's own classes; jsdom drops shorthands that hold var(), the stylesheet keeps them
function rulesFor(element)
{
    const css = [...document.querySelectorAll('style')].map((style) => style.textContent).join('\n')
    return [...element.classList].map((name) => (css.match(new RegExp(`\\.${name}\\{[^}]*\\}`)) || [''])[0]).join('\n')
}

function renderSettings(user = EMPLOYEE, extra = {})
{
    return renderPage(
        <SettingsProvider>
            <SettingsPage />
            <ThemeProbe />
        </SettingsProvider>,
        { route: '/settings', auth: fakeAuth({ user, ...extra }) },
    )
}

afterEach(() =>
{
    window.localStorage.clear()
})

describe('SettingsPage: appearance', () =>
{
    it('follows the device by default, and says which way it is set', () =>
    {
        globalThis.__prefersDark = true
        renderSettings()
        const appearance = screen.getByRole('region', { name: 'Appearance' })
        expect(within(appearance).getByRole('radio', { name: 'Match my device' })).toBeChecked()
        expect(appearance).toHaveTextContent('Following your device, which is set to dark right now.')
        expect(screen.getByTestId('theme')).toHaveTextContent(/^dark standard/)
        expect(rootVariable('paper')).toBe('#0E161C')
    })

    it('switches to dark at once, without a reload, and keeps the choice on this device', async () =>
    {
        const user = userEvent.setup()
        renderSettings()
        expect(screen.getByTestId('theme')).toHaveTextContent(/^light/)
        const appearance = screen.getByRole('region', { name: 'Appearance' })
        await user.click(within(appearance).getByRole('radio', { name: 'Dark' }))
        expect(screen.getByTestId('theme')).toHaveTextContent(/^dark/)
        await waitFor(() => expect(rootVariable('plate')).toBe('#1F4B6A'))
        expect(JSON.parse(window.localStorage.getItem('acme.settings'))).toEqual({ appearance: 'dark', palette: 'standard', motion: 'system' })
    })

    it('reads the saved choice when the app starts', () =>
    {
        window.localStorage.setItem('acme.settings', JSON.stringify({ appearance: 'light', palette: 'safe', motion: 'reduce' }))
        globalThis.__prefersDark = true
        renderSettings()
        expect(screen.getByTestId('theme')).toHaveTextContent(/^light safe/)
        expect(screen.getByRole('radio', { name: 'Colour-blind safe' })).toBeChecked()
    })

    it('still applies a change when the browser will not store it, and says so', async () =>
    {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() =>
        {
            throw new Error('QuotaExceededError')
        })
        const user = userEvent.setup()
        renderSettings()
        await user.click(screen.getByRole('radio', { name: 'Light' }))
        expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked()
        expect(screen.getByText('This browser is not keeping settings, so these apply until the tab is closed.')).toBeInTheDocument()
    })
})

describe('SettingsPage: colour-blind safe colours', () =>
{
    it('moves the status track, the board, the error colour and the chart onto Okabe-Ito colours', async () =>
    {
        const user = userEvent.setup()
        renderPage(
            <SettingsProvider>
                <SettingsPage />
                <BoardColumn status="blocked" items={[incidentFixture({ status: 'blocked', priority: 'critical' })]} total={1} />
                <ThemeProbe />
            </SettingsProvider>,
            { route: '/settings', auth: fakeAuth() },
        )
        // the preview's status track and the board column paint with the shared tokens...
        const preview = screen.getByRole('group', { name: 'Preview' })
        const blockedStep = [...preview.querySelectorAll('[data-filled="true"]')].at(-1)
        expect(blockedStep).toHaveStyle({ backgroundColor: tokens.signalRed })
        const column = screen.getByRole('region', { name: 'Blocked' })
        expect(rulesFor(column)).toContain(`border-top:4px solid ${tokens.signalRed}`)
        expect(rulesFor(column)).toContain(`background-color:${tokens.blockedTint}`)
        expect(rootVariable('signalRed')).toBe('#B42318')

        // ...so switching the palette re-points them all, words unchanged
        await user.click(screen.getByRole('radio', { name: 'Colour-blind safe' }))
        await waitFor(() => expect(rootVariable('signalRed')).toBe('#A94700'))
        expect(rootVariable('signalAmber')).toBe('#005A96')
        expect(screen.getByTestId('theme')).toHaveTextContent('light safe #D55E00')
        expect(preview).toHaveTextContent('Blocked')
        expect(preview).toHaveTextContent('Critical')
        expect(column).toHaveTextContent('Critical')
    })
})

describe('SettingsPage: motion', () =>
{
    it('follows the device, and turns every transition off when asked', async () =>
    {
        globalThis.__prefersReduced = true
        const user = userEvent.setup()
        renderSettings()
        expect(screen.getByRole('region', { name: 'Motion' })).toHaveTextContent('asks for less motion')
        expect(screen.getByTestId('theme')).toHaveTextContent(/none$/)
        await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'))

        await user.click(screen.getByRole('radio', { name: 'Allow motion' }))
        expect(screen.getByTestId('theme')).not.toHaveTextContent(/none$/)
        await waitFor(() => expect(document.documentElement.dataset.motion).toBe('full'))

        await user.click(screen.getByRole('radio', { name: 'Reduce motion' }))
        expect(screen.getByTestId('theme')).toHaveTextContent(/none$/)
    })

    it('makes section jumps instant when motion is reduced', async () =>
    {
        const scrolled = []
        Element.prototype.scrollIntoView = function scrollIntoView(options)
        {
            scrolled.push(options.behavior)
        }
        const user = userEvent.setup()
        renderSettings()
        document.body.insertAdjacentHTML('beforeend', '<div id="jump-target"></div>')
        await user.click(screen.getByRole('radio', { name: 'Reduce motion' }))
        await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'))
        scrollToSection('jump-target')
        await user.click(screen.getByRole('radio', { name: 'Allow motion' }))
        await waitFor(() => expect(document.documentElement.dataset.motion).toBe('full'))
        scrollToSection('jump-target')
        expect(scrolled).toEqual(['auto', 'smooth'])
        delete Element.prototype.scrollIntoView
        document.getElementById('jump-target').remove()
    })
})

describe('SettingsPage: viewing as', () =>
{
    it('is hidden from someone with one role', () =>
    {
        renderSettings(EMPLOYEE)
        expect(screen.queryByRole('region', { name: 'Viewing as' })).not.toBeInTheDocument()
    })

    it('offers only the roles held, switches through auth, and goes to that role\'s start page', async () =>
    {
        const user = userEvent.setup()
        const held = { ...ADMIN, roles: ['employee', 'admin'] }
        const switchRole = vi.fn().mockResolvedValue({ ...held, role: 'employee' })
        renderSettings(held, { switchRole })
        const roles = screen.getByRole('region', { name: 'Viewing as' })
        expect(within(roles).getAllByRole('radio').map((radio) => radio.value)).toEqual(['employee', 'admin'])
        expect(within(roles).getByRole('radio', { name: 'Facility admin' })).toBeChecked()

        await user.click(within(roles).getByRole('radio', { name: 'Employee' }))
        expect(switchRole).toHaveBeenCalledWith('employee')
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/tickets'))
    })

    it('stays put and says why when the server refuses the switch', async () =>
    {
        const user = userEvent.setup()
        const held = { ...ADMIN, roles: ['employee', 'engineer', 'admin'] }
        const switchRole = vi.fn().mockRejectedValue(new ApiError({ status: 403, code: 'forbidden', message: 'role not held' }))
        renderSettings(held, { switchRole })
        await user.click(screen.getByRole('radio', { name: 'Engineer' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to do that.')
        expect(screen.getByTestId('location')).toHaveTextContent('/settings')
        expect(screen.getByRole('radio', { name: 'Engineer' })).toBeEnabled()
    })
})

describe('useSettings', () =>
{
    it('is a programming error outside the provider', () =>
    {
        function Orphan()
        {
            useSettings()
            return null
        }
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        expect(() => renderPage(<Orphan />)).toThrow(/SettingsProvider/)
    })
})
