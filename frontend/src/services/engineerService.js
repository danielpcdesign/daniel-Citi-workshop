import { http } from './http.js'

// who can take new work, least loaded first: the assign picker's ordering comes from the server (M7)
export function listAvailableEngineers(options = {})
{
    return http.get('/api/engineers', { ...options, query: { available: 'true', sort: 'workload', limit: 100 } })
}

// every engineer by name, for the lookup's engineer filter; the endpoint is admin-only (M7)
export function listEngineers(options = {})
{
    return http.get('/api/engineers', { ...options, query: { sort: 'name', limit: 100 } })
}

// least loaded first: free capacity reads top down (M7, "how is work distributed")
export function listEngineersByWorkload(options = {})
{
    return http.get('/api/engineers', { ...options, query: { sort: 'workload', limit: 100 } })
}

// unavailable means "no new work": tickets already held stay with the engineer (M7)
export function setAvailability(engineerId, isAvailable, options = {})
{
    return http.put(`/api/engineers/${engineerId}/availability`, { is_available: isAvailable }, options)
}

// one engineer's profile; a user who is not an engineer answers 404, like an unknown id (M7)
export function getEngineer(engineerId, options = {})
{
    return http.get(`/api/engineers/${engineerId}`, options)
}
