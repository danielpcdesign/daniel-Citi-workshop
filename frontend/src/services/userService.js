import { http } from './http.js'

// user administration lives in the auth service, which owns roles (AD-21)
const BASE = '/api/auth/users'

// candidates for promotion: registered employees whose name or email matches
export function searchEmployees(q, options = {})
{
    return http.get(BASE, { ...options, query: { q, role: 'employee', sort: 'full_name', limit: 10 } })
}

// resolves to {user, unassigned_incidents}: a demoted engineer's active tickets go back to triage (AD-21)
export function changeRole(userId, role, options = {})
{
    return http.put(`${BASE}/${userId}/role`, { role }, options)
}
