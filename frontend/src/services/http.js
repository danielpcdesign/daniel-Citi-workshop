// the only network code in the app (AD-06): every service module calls request() and nothing else calls fetch

const REFRESH_PATH = '/api/auth/refresh'

// memory only, never storage: a reload drops it and the httpOnly refresh cookie re-mints it (AD-08a)
let accessToken = null
// one shared promise: two concurrent refreshes would present a rotated token and trip reuse detection (AD-07d)
let refreshInFlight = null
let sessionListener = null

export class ApiError extends Error
{
    constructor({ status, code, message, fields = null, requestId = null })
    {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.fields = fields
        this.requestId = requestId
    }
}

export function setAccessToken(token)
{
    accessToken = token
}

export function getAccessToken()
{
    return accessToken
}

// told when a refresh mints a new session ({user}) or the session ends (null)
export function setSessionListener(listener)
{
    sessionListener = listener
}

function notify(session)
{
    if (sessionListener)
    {
        sessionListener(session)
    }
}

export function newCorrelationId()
{
    return crypto.randomUUID()
}

// cloudfront's lambda OAC only forwards POST/PUT bodies whose sha256 the viewer declares (first cloud deploy)
export async function sha256Hex(text)
{
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function buildUrl(path, query)
{
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query || {}))
    {
        // arrays become repeated keys (status=open&status=blocked), which the list endpoints expect (AD-13)
        const values = Array.isArray(value) ? value : [value]
        for (const item of values)
        {
            if (item !== undefined && item !== null && item !== '')
            {
                params.append(key, String(item))
            }
        }
    }
    const search = params.toString()
    return search ? `${path}?${search}` : path
}

async function parseError(response)
{
    let envelope
    try
    {
        envelope = (await response.json()).error
    }
    catch
    {
        envelope = null
    }
    if (envelope && envelope.code)
    {
        return new ApiError({
            status: response.status,
            code: envelope.code,
            message: envelope.message,
            fields: envelope.fields || null,
            requestId: envelope.request_id || null,
        })
    }
    // not our envelope: a proxy or edge error page
    return new ApiError({
        status: response.status,
        code: response.status >= 500 ? 'internal' : 'unexpected',
        message: `The server answered ${response.status}.`,
    })
}

async function send(method, path, { body, query, correlationId, withToken = true })
{
    const headers = {
        'Accept': 'application/json',
        'X-Correlation-Id': correlationId,
    }
    let bodyText
    if (body !== undefined)
    {
        bodyText = JSON.stringify(body)
        headers['Content-Type'] = 'application/json'
    }
    if (method === 'POST' || method === 'PUT')
    {
        // an empty POST (refresh) still declares the hash of the empty string
        headers['x-amz-content-sha256'] = await sha256Hex(bodyText ?? '')
    }
    if (withToken && accessToken)
    {
        headers['X-Access-Token'] = accessToken
    }

    let response
    try
    {
        response = await fetch(buildUrl(path, query), {
            method,
            headers,
            body: bodyText,
            credentials: 'same-origin',
        })
    }
    catch
    {
        throw new ApiError({ status: 0, code: 'network', message: 'Could not reach the server. Check your connection and try again.' })
    }

    if (!response.ok)
    {
        throw await parseError(response)
    }
    if (response.status === 204)
    {
        return null
    }
    return response.json()
}

export function refreshSession(correlationId = newCorrelationId())
{
    if (!refreshInFlight)
    {
        refreshInFlight = send('POST', REFRESH_PATH, { correlationId, withToken: false })
            .then((session) =>
            {
                accessToken = session.access_token
                notify({ user: session.user })
                return session
            })
            .finally(() =>
            {
                refreshInFlight = null
            })
    }
    return refreshInFlight
}

// options: body, query, correlationId (one per user action, AD-16), retry (false for the auth endpoints themselves)
export async function request(method, path, options = {})
{
    const correlationId = options.correlationId || newCorrelationId()
    const sendOptions = { ...options, correlationId }
    try
    {
        return await send(method, path, sendOptions)
    }
    catch (error)
    {
        const expired = error instanceof ApiError && error.status === 401 && error.code === 'unauthenticated'
        if (!expired || options.retry === false || path === REFRESH_PATH)
        {
            throw error
        }
    }

    try
    {
        await refreshSession(correlationId)
    }
    catch (refreshError)
    {
        accessToken = null
        notify(null)
        throw refreshError
    }
    // exactly one retry: a second 401 is a real answer, not an expired token
    return send(method, path, sendOptions)
}

export const http = {
    get: (path, options) => request('GET', path, options),
    post: (path, body, options = {}) => request('POST', path, { ...options, body }),
    put: (path, body, options = {}) => request('PUT', path, { ...options, body }),
    del: (path, options) => request('DELETE', path, options),
}
