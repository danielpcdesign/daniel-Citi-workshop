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
