import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import App from './App.jsx'
import { AuthContext } from './hooks/authContext.js'
import { theme } from './theme.js'
import { ADMIN, ENGINEER, LocationProbe, fakeAuth, renderPage } from './test/render.jsx'
import RequireAuth from './components/RequireAuth.jsx'

vi.mock('./services/incidentService.js', () => ({
    listIncidents: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    getIncident: vi.fn(),
}))

vi.mock('./services/reportService.js', () => ({
    getSummary: vi.fn(() => new Promise(() => undefined)),
    getBoard: vi.fn(() => new Promise(() => undefined)),
    getAttention: vi.fn(() => new Promise(() => undefined)),
    getHotspots: vi.fn(() => new Promise(() => undefined)),
    getTimings: vi.fn(() => new Promise(() => undefined)),
}))

function renderApp(route, auth)
{
    return render(
        <ThemeProvider theme={theme}>
            <AuthContext.Provider value={auth}>
                <MemoryRouter initialEntries={[route]}>
                    <App />
                    <LocationProbe />
                </MemoryRouter>
            </AuthContext.Provider>
        </ThemeProvider>,
    )
}

describe('routing and guards', () =>
{
    it('sends a signed-out visitor to sign in', () =>
    {
        renderApp('/tickets', fakeAuth({ user: null }))
        expect(screen.getByTestId('location')).toHaveTextContent('/signin')
        expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    })

    it('waits for the session check before deciding', () =>
    {
        renderApp('/tickets', fakeAuth({ status: 'loading', user: null }))
        expect(screen.getByRole('status')).toHaveTextContent('Checking your session')
    })

    it('sends a signed-in user away from sign in, and / to their tickets', async () =>
    {
        renderApp('/signin', fakeAuth())
        expect(screen.getByTestId('location')).toHaveTextContent('/tickets')
        expect(await screen.findByRole('heading', { name: 'My tickets' })).toBeInTheDocument()
    })

    it('starts admins and engineers on the dashboard', async () =>
    {
        renderApp('/signin', fakeAuth({ user: ADMIN }))
        expect(screen.getByTestId('location')).toHaveTextContent('/dashboard')
        expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    })

    it('sends / to the starting page for the role', () =>
    {
        renderApp('/', fakeAuth({ user: ENGINEER }))
        expect(screen.getByTestId('location')).toHaveTextContent('/dashboard')
    })

    it('sends an employee who opens the dashboard to their tickets', async () =>
    {
        renderApp('/dashboard', fakeAuth())
        expect(screen.getByTestId('location')).toHaveTextContent('/tickets')
        expect(await screen.findByRole('heading', { name: 'My tickets' })).toBeInTheDocument()
    })

    it('shows the register page and a not-found page', () =>
    {
        renderApp('/register', fakeAuth({ user: null }))
        expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument()
    })

    it('shows a plain not-found page', () =>
    {
        renderApp('/nowhere', fakeAuth())
        expect(screen.getByRole('heading', { name: 'There is no page here' })).toBeInTheDocument()
    })

    it('refuses a page meant for other roles', () =>
    {
        renderPage(<RequireAuth roles={['admin']}><p>admin board</p></RequireAuth>)
        expect(screen.getByRole('alert')).toHaveTextContent('This page is for admin accounts')
        expect(screen.queryByText('admin board')).not.toBeInTheDocument()
    })

    it('lets the right role through', () =>
    {
        renderPage(<RequireAuth roles={['admin']}><p>admin board</p></RequireAuth>, { auth: fakeAuth({ user: ADMIN }) })
        expect(screen.getByText('admin board')).toBeInTheDocument()
    })
})
