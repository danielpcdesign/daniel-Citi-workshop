import { Navigate, useLocation } from 'react-router-dom'
import Typography from '@mui/material/Typography'
import { useAuth } from '../hooks/useAuth.js'
import PageLoader from './PageLoader.jsx'

// role checks here only decide what to show; the server re-checks every request (AD-09)
export default function RequireAuth({ roles, children })
{
    const { status, user } = useAuth()
    const location = useLocation()

    if (status === 'loading')
    {
        return <PageLoader label="Checking your session" />
    }
    if (!user)
    {
        return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />
    }
    if (roles && !roles.includes(user.role))
    {
        return (
            <Typography role="alert" sx={{ py: 6 }}>
                This page is for {roles.join(' and ')} accounts. Your account is {user.role}.
            </Typography>
        )
    }
    return children
}
