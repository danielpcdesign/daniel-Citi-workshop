import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AuthProvider from './AuthProvider.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { getAccessToken, http, setAccessToken } from '../services/http.js'

const USER = { id: 40, email: 'emp@acme.inc', full_name: 'Erin', role: 'employee' }

function json(status, body)
{
    return new Response(JSON.stringify(body), { status })
}

function unauthenticated()
{
    return json(401, { error: { code: 'unauthenticated', message: 'invalid', request_id: 'r' } })
}

function Probe()
{
    const auth = useAuth()
    return (
        <div>
            <span data-testid="status">{auth.status}</span>
            <span data-testid="user">{auth.user ? auth.user.full_name : 'nobody'}</span>
            <span data-testid="boot">{auth.bootError ? auth.bootError.code : 'none'}</span>
            <button onClick={() => auth.signIn('emp@acme.inc', 'pw')}>sign in</button>
            <button onClick={() => auth.register({ fullName: 'Erin', email: 'emp@acme.inc', password: 'pw' })}>register</button>
            <button onClick={() => auth.signOut().catch(() => undefined)}>sign out</button>
        </div>
    )
}

let fetchMock
const refreshCalls = () => fetchMock.mock.calls.filter(([url, init]) => url === '/api/auth/refresh' && init.method === 'POST')

beforeEach(() =>
{
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    setAccessToken(null)
})

afterEach(() =>
{
    vi.unstubAllGlobals()
})

describe('AuthProvider', () =>
{
    it('boots with exactly one refresh under StrictMode', async () =>
    {
        fetchMock.mockImplementation(async () => json(200, { access_token: 'tok', user: USER }))
        render(<StrictMode><AuthProvider><Probe /></AuthProvider></StrictMode>)
        expect(screen.getByTestId('status')).toHaveTextContent('loading')
        await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Erin'))
        expect(refreshCalls()).toHaveLength(1)
        expect(getAccessToken()).toBe('tok')
    })

    it('treats a boot 401 as signed out, without an error', async () =>
    {
        fetchMock.mockImplementation(async () => unauthenticated())
        render(<AuthProvider><Probe /></AuthProvider>)
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
        expect(screen.getByTestId('user')).toHaveTextContent('nobody')
        expect(screen.getByTestId('boot')).toHaveTextContent('none')
    })

    it('keeps a boot network failure to show on the sign-in page', async () =>
    {
        fetchMock.mockRejectedValue(new TypeError('offline'))
        render(<AuthProvider><Probe /></AuthProvider>)
        await waitFor(() => expect(screen.getByTestId('boot')).toHaveTextContent('network'))
    })

    it('signs in, registers then signs in, and signs out', async () =>
    {
        const user = userEvent.setup()
        fetchMock.mockImplementation(async (url, init) =>
        {
            if (url === '/api/auth/refresh' && init.method === 'POST')
            {
                return unauthenticated()
            }
            if (url === '/api/auth/register')
            {
                return json(201, USER)
            }
            if (url === '/api/auth/refresh' && init.method === 'DELETE')
            {
                return new Response(null, { status: 204 })
            }
            return json(200, { access_token: 'tok', user: USER })
        })
        render(<AuthProvider><Probe /></AuthProvider>)
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))

        await user.click(screen.getByText('sign in'))
        await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Erin'))

        await user.click(screen.getByText('sign out'))
        await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('nobody'))
        expect(getAccessToken()).toBeNull()

        await user.click(screen.getByText('register'))
        await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Erin'))
        const urls = fetchMock.mock.calls.map(([url]) => url)
        expect(urls.slice(-2)).toEqual(['/api/auth/register', '/api/auth/login'])
    })

    it('signs the user out when a mid-session refresh fails', async () =>
    {
        fetchMock.mockImplementationOnce(async () => json(200, { access_token: 'tok', user: USER }))
        render(<AuthProvider><Probe /></AuthProvider>)
        await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Erin'))

        fetchMock.mockImplementation(async () => unauthenticated())
        await act(async () =>
        {
            await http.get('/api/incidents').catch(() => undefined)
        })
        expect(screen.getByTestId('user')).toHaveTextContent('nobody')
    })

    it('useAuth outside the provider is a programming error', () =>
    {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        expect(() => render(<Probe />)).toThrow(/AuthProvider/)
    })
})
