import { http, refreshSession, setAccessToken } from './http.js'

const BASE = '/api/auth'

export async function login(email, password, options = {})
{
    const session = await http.post(`${BASE}/login`, { email, password }, { ...options, retry: false })
    setAccessToken(session.access_token)
    return session.user
}

// registration creates an employee and no session, so the caller signs in afterwards (AD-21)
export function register({ fullName, email, password }, options = {})
{
    return http.post(`${BASE}/register`, { full_name: fullName, email, password }, { ...options, retry: false })
}

// boot: the httpOnly cookie is the only thing that survives a reload
export async function restoreSession(options = {})
{
    const session = await refreshSession(options.correlationId)
    return session.user
}

// revokes server-side, not just locally: the cookie is only ever sent to /refresh (AD-08a)
export async function signOut(options = {})
{
    try
    {
        await http.del(`${BASE}/refresh`, { ...options, retry: false })
    }
    finally
    {
        setAccessToken(null)
    }
}

// the role to act in, from the roles held; the server re-mints the access token for it and keeps the choice on the
// refresh session, so a reload stays in that role. same shape as a refresh; the cookie is untouched
export async function setActiveRole(role, options = {})
{
    const session = await http.post(`${BASE}/active-role`, { role }, options)
    setAccessToken(session.access_token)
    return session.user
}
