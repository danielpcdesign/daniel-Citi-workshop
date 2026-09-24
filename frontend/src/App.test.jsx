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
    getFlow: vi.fn(() => new Promise(() => undefined)),
}))

vi.mock('./services/engineerService.js', () => ({
    listEngineersByWorkload: vi.fn(() => new Promise(() => undefined)),
    getEngineer: vi.fn(() => new Promise(() => undefined)),
    setAvailability: vi.fn(),
}))
vi.mock('./services/facilityService.js', () => ({
    listBuildings: vi.fn(() => new Promise(() => undefined)),
    listFloors: vi.fn(),
    listSeats: vi.fn(),
}))
vi.mock('./services/userService.js', () => ({ searchEmployees: vi.fn(() => new Promise(() => undefined)), changeRole: vi.fn() }))

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

    it('opens the engineer pages for an admin only; anyone else lands on their own start page', async () =>
    {
        renderApp('/engineers', fakeAuth({ user: ADMIN }))
        expect(await screen.findByRole('heading', { name: 'Engineers', level: 1 })).toBeInTheDocument()
        expect(screen.getByTestId('location')).toHaveTextContent('/engineers')
    })

    it('opens an engineer profile for an admin', () =>
    {
        renderApp('/engineers/6', fakeAuth({ user: ADMIN }))
        expect(screen.getByTestId('location')).toHaveTextContent('/engineers/6')
        expect(screen.getByText('Loading the engineer')).toBeInTheDocument()
    })

    it('sends an engineer away from the engineer pages to the dashboard', () =>
    {
        renderApp('/engineers', fakeAuth({ user: ENGINEER }))
        expect(screen.getByTestId('location')).toHaveTextContent('/dashboard')
    })

    it('sends an employee away from an engineer profile to their tickets', () =>
    {
        renderApp('/engineers/6', fakeAuth())
        expect(screen.getByTestId('location')).toHaveTextContent('/tickets')
    })

    it('opens facilities for an admin, and sends anyone else to their start page', async () =>
    {
        const { unmount } = renderApp('/facilities', fakeAuth({ user: ADMIN }))
        expect(await screen.findByRole('heading', { name: 'Facilities', level: 1 })).toBeInTheDocument()
        unmount()
        renderApp('/facilities', fakeAuth({ user: ENGINEER }))
        expect(screen.getByTestId('location')).toHaveTextContent('/dashboard')
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
