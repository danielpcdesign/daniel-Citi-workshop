import { http } from './http.js'

// user administration lives in the auth service, which owns roles (AD-21)
const BASE = '/api/auth/users'

// people who could be made engineers: the server's `lacks` filter, since everyone holds employee and
// `role=employee` would match engineers too
export function searchPromotable(q, options = {})
{
    return http.get(BASE, { ...options, query: { q, lacks: 'engineer', sort: 'full_name', limit: 20 } })
}

// the full set of roles to hold, replacing the old set; resolves to {user, unassigned_incidents}:
// dropping engineer sends that person's active tickets back to triage (AD-21)
export function setRoles(userId, roles, options = {})
{
    return http.put(`${BASE}/${userId}/roles`, { roles }, options)
}
