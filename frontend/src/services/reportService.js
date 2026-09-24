import { http, newCorrelationId } from './http.js'
import { listIncidents } from './incidentService.js'

const BASE = '/api/reports'

// the board's columns, in workflow order; blocked sits after in_progress because that is where it happens (AD-18)
export const BOARD_STATUSES = ['unassigned', 'open', 'in_progress', 'blocked', 'resolved', 'closed']
export const BOARD_COLUMN_LIMIT = 6

// any role: counts over what the caller can see (AD-19)
export function getSummary(options = {})
{
    return http.get(`${BASE}/summary`, options)
}

// admin only; status is repeatable, like the incidents list
export function getHotspots(filters = {}, options = {})
{
    return http.get(`${BASE}/hotspots`, { ...options, query: filters })
}

export function getTimings(filters = {}, options = {})
{
    return http.get(`${BASE}/timings`, { ...options, query: filters })
}

export function getAttention(filters = {}, options = {})
{
    return http.get(`${BASE}/attention`, { ...options, query: filters })
}

// finished work is most useful newest first; live work keeps the server's triage order (priority, then oldest)
function boardSort(status)
{
    return status === 'resolved' || status === 'closed' ? '-updated_at' : undefined
}

// one list request per column, so each column carries its own total for "+N more" (AD-13);
// one correlation id ties the requests to the single refresh that caused them (AD-16)
// filters narrow every column the same way (an engineer's profile: assignee_id); statuses picks the columns
export async function getBoard({ statuses = BOARD_STATUSES, ...filters } = {}, options = {})
{
    const correlationId = options.correlationId || newCorrelationId()
    const pages = await Promise.all(statuses.map((status) => listIncidents(
        { ...filters, status: [status], sort: boardSort(status), limit: BOARD_COLUMN_LIMIT },
        { ...options, correlationId },
    )))
    return statuses.map((status, index) => ({ status, items: pages[index].items, total: pages[index].total }))
}
