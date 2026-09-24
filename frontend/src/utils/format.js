// labels live in the ui; the api speaks codes (schema decisions, AD-20)

export const STATUS_LABEL = {
    unassigned: 'Unassigned',
    open: 'Open',
    in_progress: 'In progress',
    blocked: 'Blocked',
    resolved: 'Resolved',
    closed: 'Closed',
}

// the linear path; blocked is a detour shown on the in-progress step, never a step of its own (AD-18)
export const STEPS = ['unassigned', 'open', 'in_progress', 'resolved', 'closed']

export const CATEGORY_LABEL = {
    electrical: 'Electrical',
    plumbing: 'Plumbing',
    hvac: 'Heating and air',
    cleaning: 'Cleaning',
    furniture: 'Furniture',
    access_security: 'Access and security',
    network: 'Network',
    hardware: 'Hardware',
    software: 'Software',
    other: 'Something else',
}

export const PRIORITY_LABEL = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    critical: 'Critical',
}

export const PRIORITY_HINT = {
    low: 'Can wait a few days',
    medium: 'Slows work down',
    high: 'Stops work for someone',
    critical: 'Safety risk or stops work for many',
}

export const ESCALATION_LABEL = {
    none: 'Not escalated',
    pending: 'Escalation requested',
    granted: 'Escalated',
    declined: 'Escalation declined',
}

export function fmtStatus(status)
{
    return STATUS_LABEL[status] || status
}

export function fmtRef(id)
{
    return `INC-${id}`
}

// the position a status occupies on the linear path
export function stepIndex(status)
{
    return status === 'blocked' ? STEPS.indexOf('in_progress') : STEPS.indexOf(status)
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function fmtDateTime(iso)
{
    return iso ? dateTime.format(new Date(iso)) : ''
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
]

export function fmtAgo(iso, now = Date.now())
{
    const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
    for (const [unit, size] of UNITS)
    {
        if (Math.abs(seconds) >= size)
        {
            return relative.format(Math.round(seconds / size), unit)
        }
    }
    return 'just now'
}

// "Live HQ, Floor 2, Seat 14"; an archived place keeps its name so old tickets still read (AD-22)
export function fmtLocation(location)
{
    if (!location || !location.building)
    {
        return 'No location'
    }
    return ['building', 'floor', 'seat']
        .map((level) => location[level])
        .filter(Boolean)
        .map((place) => (place.archived ? `${place.name} (archived)` : place.name))
        .join(', ')
}

export function anyArchived(location)
{
    return Boolean(location) && ['building', 'floor', 'seat'].some((level) => location[level]?.archived)
}

// the latest reason recorded for entering a status: history is the record, notes may be edited (AD-01)
export function latestReason(history, status)
{
    const entries = (history || []).filter((entry) => entry.to === status)
    return entries.length ? entries[entries.length - 1].reason : null
}

// plain-language "what happens next" for the person who reported it (M12: keeping employees informed)
export function nextStep(incident)
{
    const who = incident.assignee_name || 'The engineer'
    const lines = {
        unassigned: 'Waiting for a facility admin to pick an engineer.',
        open: `${who} has been assigned and will start soon.`,
        in_progress: `${who} is working on it.`,
        blocked: `${who} is waiting on something before work can continue.`,
        resolved: `${who} marked it fixed. An admin will check and close it.`,
        closed: 'Done. This ticket is closed.',
    }
    const line = lines[incident.status] || ''
    if (incident.escalation_status === 'pending')
    {
        return `${line} An escalation request is waiting for an admin.`
    }
    return line
}

const DURATION_UNITS = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
]
const list = new Intl.ListFormat(undefined, { style: 'narrow', type: 'unit' })

// "2 days 3 hours": the two largest units are enough to compare timings at a glance; Intl only, no date library
export function fmtDuration(seconds)
{
    if (seconds === null || seconds === undefined)
    {
        return 'Not measured yet'
    }
    let remaining = Math.max(0, Math.round(seconds))
    const parts = []
    for (const [unit, size] of DURATION_UNITS)
    {
        const amount = Math.floor(remaining / size)
        if (amount > 0 && parts.length < 2)
        {
            parts.push(new Intl.NumberFormat(undefined, { style: 'unit', unit, unitDisplay: 'long' }).format(amount))
            remaining -= amount * size
        }
        else if (parts.length)
        {
            // stop at the first gap: "1 day 4 seconds" reads as more precise than it is
            break
        }
    }
    return parts.length ? list.format(parts) : '0 seconds'
}
