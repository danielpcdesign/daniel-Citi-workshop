import { Outlet, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import HomeRedirect from './components/HomeRedirect.jsx'
import PublicOnly from './components/PublicOnly.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import { DASHBOARD_ROLES } from './utils/roles.js'
import DashboardPage from './pages/DashboardPage.jsx'
import EngineerProfilePage from './pages/EngineerProfilePage.jsx'
import EngineersPage from './pages/EngineersPage.jsx'
import FacilitiesPage from './pages/FacilitiesPage.jsx'
import IncidentPage from './pages/IncidentPage.jsx'
import MyTicketsPage from './pages/MyTicketsPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import ReportPage from './pages/ReportPage.jsx'
import SignInPage from './pages/SignInPage.jsx'

export default function App()
{
    return (
        <Routes>
            <Route element={<AppShell><Outlet /></AppShell>}>
                <Route path="/signin" element={<PublicOnly><SignInPage /></PublicOnly>} />
                <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
                <Route path="/" element={<RequireAuth><HomeRedirect /></RequireAuth>} />
                <Route
                    path="/dashboard"
                    element={<RequireAuth roles={DASHBOARD_ROLES} redirectTo="/tickets"><DashboardPage /></RequireAuth>}
                />
                {/* admin only; anyone else lands on their own home page (AD-09) */}
                <Route path="/engineers" element={<RequireAuth roles={['admin']} redirectTo="/"><EngineersPage /></RequireAuth>} />
                <Route path="/engineers/:id" element={<RequireAuth roles={['admin']} redirectTo="/"><EngineerProfilePage /></RequireAuth>} />
                <Route path="/facilities" element={<RequireAuth roles={['admin']} redirectTo="/"><FacilitiesPage /></RequireAuth>} />
                <Route path="/tickets" element={<RequireAuth><MyTicketsPage /></RequireAuth>} />
                <Route path="/report" element={<RequireAuth><ReportPage /></RequireAuth>} />
                <Route path="/incidents/:id" element={<RequireAuth><IncidentPage /></RequireAuth>} />
                <Route path="*" element={<NotFoundPage />} />
            </Route>
        </Routes>
    )
}
