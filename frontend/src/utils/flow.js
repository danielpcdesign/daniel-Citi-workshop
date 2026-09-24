// cumulative flow: one server response (hourly snapshots, 90 days) cut into the ranges the dashboard offers.
// values are stock counts ("how many tickets were open at that moment"), so days are sampled, never summed

export const FLOW_STATUSES = ['unassigned', 'open', 'in_progress', 'blocked', 'resolved', 'closed']
// bottom to top: finished work settles at the base, new work arrives on top (the usual CFD reading)
export const STACK_ORDER = ['closed', 'resolved', 'blocked', 'in_progress', 'open', 'unassigned']

export const RANGES = [
    { key: 'today', label: 'Today', days: 1, hourly: true },
    { key: '7d', label: '7 days', days: 7 },
    { key: '30d', label: 'Last month', days: 30 },
    { key: '90d', label: 'Last 3 months', days: 90 },
]
export const DEFAULT_RANGE = '7d'

// midnight in the browser's time zone; the server's offset is irrelevant once `at` is parsed as an instant
export function startOfLocalDay(time)
{
    const day = new Date(time)
    day.setHours(0, 0, 0, 0)
    return day
}

// calendar days, not 24-hour steps: a daylight-saving change makes one day 23 or 25 hours long
export function daysBefore(date, days)
{
    const earlier = new Date(date)
    earlier.setDate(earlier.getDate() - days)
    return earlier
}

function localDayKey(date)
{
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

// the last snapshot of each local day: how the day ended (or, today, how things stand now)
export function dailySample(points)
{
    const byDay = new Map()
    for (const point of points)
    {
        byDay.set(localDayKey(point.time), point)
    }
    return [...byDay.values()]
}

// points: the response's `points`, oldest first; returns the range's points with `time` as a Date
export function flowRange(points, rangeKey, now = Date.now())
{
    const range = RANGES.find((candidate) => candidate.key === rangeKey) || RANGES.find((candidate) => candidate.key === DEFAULT_RANGE)
    // "7 days" is today and the six before it, each from local midnight
    const from = daysBefore(startOfLocalDay(now), range.days - 1)
    const inRange = points
        .map((point) => ({ ...point, time: new Date(point.at) }))
        .filter((point) => point.time >= from)
    return range.hourly ? inRange : dailySample(inRange)
}

export function flowIsEmpty(points)
{
    return points.every((point) => FLOW_STATUSES.every((status) => !point[status]))
}
