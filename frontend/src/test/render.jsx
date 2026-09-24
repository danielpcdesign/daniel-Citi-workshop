import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { AuthContext } from '../hooks/authContext.js'
import { theme } from '../theme.js'

export const EMPLOYEE = { id: 40, email: 'emp@acme.inc', full_name: 'Erin Employee', role: 'employee' }
export const ENGINEER = { id: 41, email: 'eng@acme.inc', full_name: 'Eli Engineer', role: 'engineer' }
export const ADMIN = { id: 42, email: 'adm@acme.inc', full_name: 'Ada Admin', role: 'admin' }

export function fakeAuth(overrides = {})
{
    return {
        status: 'ready',
        user: EMPLOYEE,
        bootError: null,
        signIn: async () => EMPLOYEE,
        register: async () => EMPLOYEE,
        signOut: async () => undefined,
        ...overrides,
    }
}

// shows where the router ended up, so tests can assert navigation
export function LocationProbe()
{
    const location = useLocation()
    return <div data-testid="location">{location.pathname}{location.search}</div>
}

// ui rendered at `route`; `path` is the route pattern when the page reads params
export function renderPage(ui, { route = '/', path = '*', auth = fakeAuth(), state } = {})
{
    return render(
        <ThemeProvider theme={theme}>
            <AuthContext.Provider value={auth}>
                <MemoryRouter initialEntries={[{ pathname: route.split('?')[0], search: route.includes('?') ? `?${route.split('?')[1]}` : '', state }]}>
                    <Routes>
                        <Route path={path} element={<>{ui}<LocationProbe /></>} />
                        <Route path="*" element={<LocationProbe />} />
                    </Routes>
                </MemoryRouter>
            </AuthContext.Provider>
        </ThemeProvider>,
    )
}

export function incidentFixture(overrides = {})
{
    return {
        id: 12,
        title: 'Kitchen tap leaking',
        description: 'Dripping since Monday.',
        category: 'plumbing',
        status: 'unassigned',
        priority: 'medium',
        requested_priority: 'medium',
        escalation_status: 'none',
        reporter_id: EMPLOYEE.id,
        reporter_name: 'Erin Employee',
        assignee_id: null,
        assignee_name: null,
        location: {
            building: { id: 1, name: 'Live HQ', archived: false },
            floor: { id: 2, name: 'Floor 3', archived: false },
            seat: null,
        },
        created_at: '2026-09-20T09:00:00+00:00',
        updated_at: '2026-09-21T09:00:00+00:00',
        actions: { edit: [], delete: false, assign: false, transitions: [], request_escalation: false, set_escalation: false },
        history: [{ from: null, to: 'unassigned', at: '2026-09-20T09:00:00+00:00', actor_id: 40, actor_name: 'Erin Employee', assignee_id: null, assignee_name: null, reason: null }],
        ...overrides,
    }
}
