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
