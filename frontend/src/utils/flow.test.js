import { describe, expect, it } from 'vitest'
import { DEFAULT_RANGE, FLOW_STATUSES, RANGES, STACK_ORDER, dailySample, daysBefore, flowIsEmpty, flowRange, startOfLocalDay } from './flow.js'

// dates are built from local components, so the expectations hold in any time zone the tests run in
function local(year, month, day, hour = 0, minute = 0)
{
    return new Date(year, month - 1, day, hour, minute)
}

// one snapshot per hour from `start` for `hours` hours; every count carries the hour index so a pick can be identified
function hourly(start, hours)
{
    return Array.from({ length: hours }, (unused, index) =>
    {
        const at = new Date(start.getTime() + index * 3600000)
        return { at: at.toISOString(), unassigned: index, open: 1, in_progress: 0, blocked: 0, resolved: 0, closed: 0 }
    })
}

// 2026-09-24 13:30 local is "now"; 10 days of hourly points up to 13:00, then a last point at 13:30 like the server's
const NOW = local(2026, 9, 24, 13, 30)
const POINTS = [
    ...hourly(local(2026, 9, 14, 0), 10 * 24 + 14),
    { at: NOW.toISOString(), unassigned: 99, open: 2, in_progress: 1, blocked: 1, resolved: 0, closed: 4 },
]

describe('startOfLocalDay and daysBefore', () =>
{
    it('finds local midnight', () =>
    {
        expect(startOfLocalDay(local(2026, 9, 24, 13, 30))).toEqual(local(2026, 9, 24))
    })

    it('steps back calendar days across a month end, landing on midnight', () =>
    {
        expect(daysBefore(local(2026, 10, 2), 3)).toEqual(local(2026, 9, 29))
    })

    it('keeps midnight across a daylight-saving change, where a day is not 24 hours', () =>
    {
        const earlier = daysBefore(local(2026, 3, 30), 2)
        expect(earlier.getDate()).toBe(28)
        expect(earlier.getHours()).toBe(0)
    })
})

describe('flowRange', () =>
{
    it('Today keeps every hourly point since local midnight, now included', () =>
    {
        const today = flowRange(POINTS, 'today', NOW)
        // 00:00 through 13:00 is 14 points, plus now
        expect(today).toHaveLength(15)
        expect(today[0].time).toEqual(local(2026, 9, 24, 0))
        expect(today.at(-1).time).toEqual(NOW)
        expect(today.every((point) => point.time instanceof Date)).toBe(true)
    })

    it('7 days is today and the six days before, one point per day: the last of each day', () =>
    {
        const week = flowRange(POINTS, '7d', NOW)
        expect(week).toHaveLength(7)
        expect(week.map((point) => point.time.getDate())).toEqual([18, 19, 20, 21, 22, 23, 24])
        // a finished day ends at 23:00; today's sample is now
        expect(week[0].time.getHours()).toBe(23)
        expect(week.at(-1).time).toEqual(NOW)
    })

    it('samples the counts, never sums them: a day is worth its last snapshot', () =>
    {
        const week = flowRange(POINTS, '7d', NOW)
        const lastOfTheEighteenth = POINTS.find((point) => new Date(point.at).getTime() === local(2026, 9, 18, 23).getTime())
        expect(week[0].unassigned).toBe(lastOfTheEighteenth.unassigned)
        expect(week[0].open).toBe(1)
        expect(week.at(-1).unassigned).toBe(99)
    })

    it('Last month and Last 3 months are limited by the data there is', () =>
    {
        // the fixture covers 11 local days (the 14th to the 24th)
        expect(flowRange(POINTS, '30d', NOW)).toHaveLength(11)
        expect(flowRange(POINTS, '90d', NOW)).toHaveLength(11)
    })

    it('Last month starts 29 days before today', () =>
    {
        const long = hourly(local(2026, 8, 1), 60 * 24)
        const month = flowRange(long, '30d', local(2026, 9, 29, 12))
        expect(month[0].time.getMonth()).toBe(7)
        expect(month[0].time.getDate()).toBe(31)
        expect(month).toHaveLength(30)
    })

    it('reads offsets as instants and buckets them by the local day', () =>
    {
        const a = local(2026, 9, 24, 1)
        const b = local(2026, 9, 24, 22)
        // the same instants written with a different offset than the browser's own
        const withOffset = (date) => date.toISOString().replace('Z', '+00:00')
        const points = [
            { at: withOffset(a), unassigned: 1, open: 0, in_progress: 0, blocked: 0, resolved: 0, closed: 0 },
            { at: withOffset(b), unassigned: 2, open: 0, in_progress: 0, blocked: 0, resolved: 0, closed: 0 },
        ]
        const sampled = flowRange(points, '7d', local(2026, 9, 24, 23))
        expect(sampled).toHaveLength(1)
        expect(sampled[0].unassigned).toBe(2)
    })

    it('falls back to the default range for an unknown key', () =>
    {
        expect(DEFAULT_RANGE).toBe('7d')
        expect(flowRange(POINTS, 'decade', NOW)).toEqual(flowRange(POINTS, '7d', NOW))
    })

    it('uses the current time when none is given', () =>
    {
        const recent = hourly(new Date(Date.now() - 3 * 3600000), 3)
        expect(flowRange(recent, '7d').length).toBeGreaterThan(0)
    })

    it('returns nothing for an empty response', () =>
    {
        expect(flowRange([], 'today', NOW)).toEqual([])
    })
})

describe('dailySample', () =>
{
    it('keeps days in order and the last point of each', () =>
    {
        const points = [
            { time: local(2026, 9, 1, 9), n: 1 },
            { time: local(2026, 9, 1, 17), n: 2 },
            { time: local(2026, 9, 2, 8), n: 3 },
        ]
        expect(dailySample(points).map((point) => point.n)).toEqual([2, 3])
    })
})

describe('flowIsEmpty', () =>
{
    it('is true only when every status is zero at every point', () =>
    {
        const zero = { unassigned: 0, open: 0, in_progress: 0, blocked: 0, resolved: 0, closed: 0 }
        expect(flowIsEmpty([zero, zero])).toBe(true)
        expect(flowIsEmpty([zero, { ...zero, closed: 1 }])).toBe(false)
        expect(flowIsEmpty([])).toBe(true)
    })
})

describe('constants', () =>
{
    it('stacks every status once, finished work at the bottom', () =>
    {
        expect([...STACK_ORDER].sort()).toEqual([...FLOW_STATUSES].sort())
        expect(STACK_ORDER[0]).toBe('closed')
        expect(STACK_ORDER.at(-1)).toBe('unassigned')
        expect(RANGES.map((range) => range.label)).toEqual(['Today', '7 days', 'Last month', 'Last 3 months'])
    })
})
