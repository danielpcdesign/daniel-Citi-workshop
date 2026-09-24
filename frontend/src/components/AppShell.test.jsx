import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppShell from './AppShell.jsx'
import { ADMIN, ENGINEER, EMPLOYEE, fakeAuth, renderPage } from '../test/render.jsx'
import { hardNavigate } from '../utils/browser.js'

vi.mock('../utils/browser.js', () => ({ hardNavigate: vi.fn() }))

function phoneScreen()
{
    globalThis.__screenWidth = 375
}

describe('AppShell', () =>
{
    it('shows the nav, who is signed in, and signs out', async () =>
    {
        const user = userEvent.setup()
        const signOut = vi.fn().mockRejectedValue(new Error('offline'))
        renderPage(<AppShell><p>page</p></AppShell>, { route: '/tickets', auth: fakeAuth({ user: ENGINEER, signOut }) })
        expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard')
        expect(screen.getByRole('link', { name: 'My tickets' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Report a problem' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /ACME Facilities/ })).toHaveAttribute('href', '/dashboard')
        expect(screen.getByText('Eli Engineer, Engineer')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Sign out' }))
        expect(signOut).toHaveBeenCalled()
        await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/signin'))
    })

    it('shows the engineers page to admins only, between Dashboard and My tickets', () =>
    {
        renderPage(<AppShell><p>page</p></AppShell>, { auth: fakeAuth({ user: ADMIN }) })
        const nav = screen.getByRole('navigation', { name: 'Main' })
        expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Dashboard', 'Engineers', 'My tickets', 'Report a problem'])
        expect(within(nav).getByRole('link', { name: 'Engineers' })).toHaveAttribute('href', '/engineers')
    })

    it('keeps the engineers page out of an engineer\'s and an employee\'s nav', () =>
    {
        const { unmount } = renderPage(<AppShell><p>page</p></AppShell>, { auth: fakeAuth({ user: ENGINEER }) })
        expect(screen.queryByRole('link', { name: 'Engineers' })).not.toBeInTheDocument()
        unmount()
        renderPage(<AppShell><p>page</p></AppShell>, { auth: fakeAuth({ user: EMPLOYEE }) })
        expect(screen.queryByRole('link', { name: 'Engineers' })).not.toBeInTheDocument()
    })

    it('keeps the dashboard out of an employee\'s nav', () =>
    {
        renderPage(<AppShell><p>page</p></AppShell>, { auth: fakeAuth({ user: EMPLOYEE }) })
        expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
        expect(screen.getByRole('link', { name: /ACME Facilities/ })).toHaveAttribute('href', '/tickets')
    })

    it('hides the nav when nobody is signed in', () =>
    {
        renderPage(<AppShell><p>page</p></AppShell>, { auth: fakeAuth({ user: null }) })
        expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
        expect(screen.getByText('page')).toBeInTheDocument()
    })

    it('uses a menu on small screens', async () =>
    {
        phoneScreen()
        const user = userEvent.setup()
        const signOut = vi.fn().mockResolvedValue()
        renderPage(<AppShell><p>page</p></AppShell>, { auth: fakeAuth({ signOut }) })
        expect(screen.queryByRole('link', { name: 'My tickets' })).not.toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Open menu' }))
        await user.click(await screen.findByRole('link', { name: 'Report a problem' }))
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/report'))
        // the closing drawer keeps the page aria-hidden until it has gone
        await user.click(await screen.findByRole('button', { name: 'Open menu' }))
        await user.click(await screen.findByRole('button', { name: 'Sign out' }))
        expect(signOut).toHaveBeenCalled()
    })
})
