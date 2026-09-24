import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.js'
import { homePath } from '../utils/roles.js'

// "/" means "my starting page", which depends on the role
export default function HomeRedirect()
{
    const { user } = useAuth()
    return <Navigate to={homePath(user)} replace />
}
