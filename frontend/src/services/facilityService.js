import { http } from './http.js'

const BASE = '/api/facilities'
// a picker needs every option on one page; 100 is the server's maximum (AD-13)
const PICKER = { limit: 100, sort: 'name' }

export function listBuildings(options = {})
{
    return http.get(`${BASE}/buildings`, { ...options, query: PICKER })
}

export function listFloors(buildingId, options = {})
{
    return http.get(`${BASE}/buildings/${buildingId}/floors`, { ...options, query: PICKER })
}

export function listSeats(floorId, options = {})
{
    return http.get(`${BASE}/floors/${floorId}/seats`, { ...options, query: PICKER })
}
