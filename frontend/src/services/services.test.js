import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken, setAccessToken } from './http.js'
import { login, register, restoreSession, signOut } from './authService.js'
import {
    assignIncident,
    createIncident,
    decideEscalation,
    getIncident,
    listIncidents,
    requestEscalation,
    transitionIncident,
} from './incidentService.js'
import { addNote, deleteNote, editNote, listNotes } from './noteService.js'
import { listBuildings, listFloors, listSeats } from './facilityService.js'
import { getEngineer, listAvailableEngineers, listEngineers, listEngineersByWorkload, setAvailability } from './engineerService.js'
import { changeRole, searchEmployees } from './userService.js'

let fetchMock

function ok(body = {})
{
    return new Response(JSON.stringify(body), { status: 200 })
}

function lastCall()
{
    const [url, init] = fetchMock.mock.calls.at(-1)
    return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined }
}

beforeEach(() =>
{
    fetchMock = vi.fn().mockImplementation(async () => ok({ access_token: 'tok', user: { id: 3 } }))
    vi.stubGlobal('fetch', fetchMock)
    setAccessToken(null)
})

afterEach(() =>
{
    vi.unstubAllGlobals()
})

describe('authService', () =>
{
    it('login stores the token in memory and returns the user', async () =>
    {
        const user = await login('a@acme.inc', 'a long enough password')
        expect(user).toEqual({ id: 3 })
        expect(getAccessToken()).toBe('tok')
        expect(lastCall()).toEqual({ url: '/api/auth/login', method: 'POST', body: { email: 'a@acme.inc', password: 'a long enough password' } })
    })

    it('register sends full_name', async () =>
    {
        await register({ fullName: 'Ada', email: 'a@acme.inc', password: 'pw' })
        expect(lastCall().body).toEqual({ full_name: 'Ada', email: 'a@acme.inc', password: 'pw' })
    })

    it('restoreSession refreshes from the cookie', async () =>
    {
        expect(await restoreSession()).toEqual({ id: 3 })
        expect(lastCall().url).toBe('/api/auth/refresh')
    })

    it('signOut revokes server-side and forgets the token even if the call fails', async () =>
    {
        setAccessToken('tok')
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        await signOut()
        expect(lastCall()).toMatchObject({ url: '/api/auth/refresh', method: 'DELETE' })
        expect(getAccessToken()).toBeNull()

        setAccessToken('tok')
        fetchMock.mockRejectedValueOnce(new TypeError('offline'))
        await expect(signOut()).rejects.toMatchObject({ code: 'network' })
        expect(getAccessToken()).toBeNull()
    })
})

describe('incidentService', () =>
{
    it('maps each call to its endpoint', async () =>
    {
        await listIncidents({ status: ['open'], reporter_id: 3, page: 1 })
        expect(lastCall().url).toBe('/api/incidents?status=open&reporter_id=3&page=1')
        await getIncident(9)
        expect(lastCall().url).toBe('/api/incidents/9')
        await createIncident({ title: 't' })
        expect(lastCall()).toMatchObject({ url: '/api/incidents', method: 'POST', body: { title: 't' } })
        await transitionIncident(9, 'in_progress')
        expect(lastCall()).toMatchObject({ url: '/api/incidents/9/transitions', body: { to: 'in_progress' } })
        await transitionIncident(9, 'blocked', 'waiting for parts')
        expect(lastCall().body).toEqual({ to: 'blocked', reason: 'waiting for parts' })
        await assignIncident(9, 5)
        expect(lastCall()).toMatchObject({ url: '/api/incidents/9/assignment', body: { engineer_id: 5 } })
        await requestEscalation(9, 'flooding')
        expect(lastCall()).toMatchObject({ url: '/api/incidents/9/escalation', method: 'POST', body: { reason: 'flooding' } })
        await decideEscalation(9, 'granted', 'agreed')
        expect(lastCall()).toMatchObject({ url: '/api/incidents/9/escalation', method: 'PUT', body: { status: 'granted', reason: 'agreed' } })
    })
})

describe('noteService', () =>
{
    it('maps each call to its endpoint', async () =>
    {
        await listNotes(4)
        expect(lastCall().url).toBe('/api/incidents/4/notes?page=1&limit=100')
        await addNote(4, 'hello')
        expect(lastCall()).toMatchObject({ url: '/api/incidents/4/notes', method: 'POST', body: { body: 'hello' } })
        await editNote(4, 8, 'hi')
        expect(lastCall()).toMatchObject({ url: '/api/incidents/4/notes/8', method: 'PUT', body: { body: 'hi' } })
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        await deleteNote(4, 8)
        expect(lastCall()).toMatchObject({ url: '/api/incidents/4/notes/8', method: 'DELETE' })
    })
})

describe('facility and engineer services', () =>
{
    it('asks for whole pickers, sorted by the server', async () =>
    {
        await listBuildings()
        expect(lastCall().url).toBe('/api/facilities/buildings?limit=100&sort=name')
        await listFloors(2)
        expect(lastCall().url).toBe('/api/facilities/buildings/2/floors?limit=100&sort=name')
        await listSeats(6)
        expect(lastCall().url).toBe('/api/facilities/floors/6/seats?limit=100&sort=name')
        await listAvailableEngineers()
        expect(lastCall().url).toBe('/api/engineers?available=true&sort=workload&limit=100')
        await listEngineers()
        expect(lastCall().url).toBe('/api/engineers?sort=name&limit=100')
        await listEngineersByWorkload()
        expect(lastCall().url).toBe('/api/engineers?sort=workload&limit=100')
    })

    it('manages engineers and roles', async () =>
    {
        await getEngineer(5)
        expect(lastCall()).toEqual({ url: '/api/engineers/5', method: 'GET', body: undefined })
        await setAvailability(5, false)
        expect(lastCall()).toEqual({ url: '/api/engineers/5/availability', method: 'PUT', body: { is_available: false } })
        await searchEmployees('ali')
        expect(lastCall().url).toBe('/api/auth/users?q=ali&role=employee&sort=full_name&limit=10')
        await changeRole(9, 'engineer')
        expect(lastCall()).toEqual({ url: '/api/auth/users/9/role', method: 'PUT', body: { role: 'engineer' } })
    })
})
