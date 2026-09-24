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

// admin writes (AD-22). a place is addressed by its level's path: buildings, floors, seats
const PATHS = { building: 'buildings', floor: 'floors', seat: 'seats' }

// children are always created under their parent: floors under a building, seats under a floor
export function createPlace(level, parentId, name, options = {})
{
    const paths = {
        building: `${BASE}/buildings`,
        floor: `${BASE}/buildings/${parentId}/floors`,
        seat: `${BASE}/floors/${parentId}/seats`,
    }
    return http.post(paths[level], { name }, options)
}

export function renamePlace(level, id, name, options = {})
{
    return http.put(`${BASE}/${PATHS[level]}/${id}`, { name }, options)
}

// archive, not delete: the server cascades to children, and tickets keep the name (AD-22)
export function archivePlace(level, id, options = {})
{
    return http.del(`${BASE}/${PATHS[level]}/${id}`, options)
}
