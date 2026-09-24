import { http } from './http.js'

const BASE = '/api/incidents'

// filters map 1:1 onto the server's query params (AD-13); arrays become repeated keys
export function listIncidents(filters = {}, options = {})
{
    return http.get(BASE, { ...options, query: filters })
}

export function getIncident(id, options = {})
{
    return http.get(`${BASE}/${id}`, options)
}

export function createIncident(incident, options = {})
{
    return http.post(BASE, incident, options)
}

export function transitionIncident(id, to, reason, options = {})
{
    const body = reason ? { to, reason } : { to }
    return http.post(`${BASE}/${id}/transitions`, body, options)
}

export function assignIncident(id, engineerId, options = {})
{
    return http.post(`${BASE}/${id}/assignment`, { engineer_id: engineerId }, options)
}

export function requestEscalation(id, reason, options = {})
{
    return http.post(`${BASE}/${id}/escalation`, { reason }, options)
}

export function decideEscalation(id, status, reason, options = {})
{
    return http.put(`${BASE}/${id}/escalation`, { status, reason }, options)
}
