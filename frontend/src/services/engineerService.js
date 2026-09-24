import { http } from './http.js'

// who can take new work, least loaded first: the assign picker's ordering comes from the server (M7)
export function listAvailableEngineers(options = {})
{
    return http.get('/api/engineers', { ...options, query: { available: 'true', sort: 'workload', limit: 100 } })
}
