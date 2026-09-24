import { describe, expect, it } from 'vitest'
import { anyArchived, fmtAgo, fmtDateTime, fmtDuration, fmtLocation, fmtRef, fmtStatus, latestReason, nextStep, stepIndex } from './format.js'
import { fieldError, unplacedError } from './errors.js'

describe('format', () =>
{
    it('labels statuses and refs', () =>
    {
        expect(fmtStatus('in_progress')).toBe('In progress')
        expect(fmtStatus('mystery')).toBe('mystery')
        expect(fmtRef(42)).toBe('INC-42')
    })

    it('puts blocked on the in-progress position', () =>
    {
        expect(stepIndex('unassigned')).toBe(0)
        expect(stepIndex('blocked')).toBe(stepIndex('in_progress'))
        expect(stepIndex('closed')).toBe(4)
    })

    it('names a location and flags archived places', () =>
    {
        const location = {
            building: { id: 1, name: 'HQ', archived: true },
            floor: { id: 2, name: 'Floor 1', archived: false },
            seat: null,
        }
        expect(fmtLocation(location)).toBe('HQ (archived), Floor 1')
        expect(anyArchived(location)).toBe(true)
        expect(anyArchived({ building: { name: 'HQ', archived: false } })).toBe(false)
        expect(anyArchived(null)).toBe(false)
        expect(fmtLocation(null)).toBe('No location')
    })

    it('formats times', () =>
    {
        const now = Date.parse('2026-09-24T12:00:00Z')
        expect(fmtAgo('2026-09-24T11:59:50Z', now)).toBe('just now')
        expect(fmtAgo('2026-09-24T10:00:00Z', now)).toBe('2 hours ago')
        expect(fmtAgo('2026-09-21T12:00:00Z', now)).toBe('3 days ago')
        expect(fmtDateTime(null)).toBe('')
        expect(fmtDateTime('2026-09-24T12:00:00Z')).toMatch(/2026/)
    })

    it('reads the latest reason from history', () =>
    {
        const history = [
            { to: 'blocked', reason: 'first' },
            { to: 'in_progress', reason: null },
            { to: 'blocked', reason: 'second' },
        ]
        expect(latestReason(history, 'blocked')).toBe('second')
        expect(latestReason(history, 'closed')).toBeNull()
        expect(latestReason(undefined, 'blocked')).toBeNull()
    })

    it('says what happens next in plain words', () =>
    {
        expect(nextStep({ status: 'unassigned', escalation_status: 'none' })).toMatch(/facility admin/)
        expect(nextStep({ status: 'in_progress', assignee_name: 'Eli', escalation_status: 'none' })).toBe('Eli is working on it.')
        expect(nextStep({ status: 'open', escalation_status: 'pending' })).toMatch(/The engineer has been assigned.*escalation request/)
        expect(nextStep({ status: 'weird', escalation_status: 'none' })).toBe('')
    })
})

describe('fmtDuration', () =>
{
    it('writes the two largest units, stopping at the first gap', () =>
    {
        expect(fmtDuration(null)).toBe('Not measured yet')
        expect(fmtDuration(0)).toBe('0 seconds')
        expect(fmtDuration(45)).toBe('45 seconds')
        expect(fmtDuration(5400)).toBe('1 hour 30 minutes')
        expect(fmtDuration(90061)).toBe('1 day 1 hour')
        expect(fmtDuration(86404)).toBe('1 day')
        expect(fmtDuration(2 * 86400 + 7200)).toBe('2 days 2 hours')
    })
})

describe('errors', () =>
{
    it('cleans pydantic prefixes', () =>
    {
        expect(fieldError({ fields: { email: 'Value error, must be an @acme.inc address' } }, 'email')).toBe('Must be an @acme.inc address')
        expect(fieldError(null, 'email')).toBeNull()
    })

    it('reports an error nobody can place beside an input', () =>
    {
        expect(unplacedError(null, ['a'])).toBeNull()
        expect(unplacedError({ fields: { a: 'x' } }, ['a'])).toBeNull()
        const stray = { fields: { a: 'x', incident: 'y' } }
        expect(unplacedError(stray, ['a'])).toBe(stray)
        const plain = { code: 'internal' }
        expect(unplacedError(plain, ['a'])).toBe(plain)
    })
})
