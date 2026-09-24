import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.js'
import PageLoader from './PageLoader.jsx'
import { homePath } from '../utils/roles.js'

// sign-in and register make no sense once signed in: go where the user was heading
export default function PublicOnly({ children })
{
    const { status, user } = useAuth()
    const location = useLocation()

    if (status === 'loading')
    {
        return <PageLoader label="Checking your session" />
    }
    if (user)
    {
        return <Navigate to={location.state?.from || homePath(user)} replace />
    }
    return children
}
