import { http } from './http.js'

const notesPath = (incidentId) => `/api/incidents/${incidentId}/notes`

// one chronological thread, oldest first (AD-01); 100 is the server's page maximum
export function listNotes(incidentId, { page = 1, limit = 100 } = {}, options = {})
{
    return http.get(notesPath(incidentId), { ...options, query: { page, limit } })
}

export function addNote(incidentId, body, options = {})
{
    return http.post(notesPath(incidentId), { body }, options)
}

export function editNote(incidentId, noteId, body, options = {})
{
    return http.put(`${notesPath(incidentId)}/${noteId}`, { body }, options)
}

export function deleteNote(incidentId, noteId, options = {})
{
    return http.del(`${notesPath(incidentId)}/${noteId}`, options)
}
