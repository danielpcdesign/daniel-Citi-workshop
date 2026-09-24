import { describe, expect, it } from 'vitest'
import { heldRoles, withRole, withoutRole } from './roles.js'

describe('role sets', () =>
{
    it('reads the held roles, or the active one from responses that predate roles', () =>
    {
        expect(heldRoles({ role: 'admin', roles: ['employee', 'admin'] })).toEqual(['employee', 'admin'])
        expect(heldRoles({ role: 'engineer' })).toEqual(['engineer'])
        expect(heldRoles({ role: 'engineer', roles: [] })).toEqual(['engineer'])
        expect(heldRoles(null)).toEqual([])
    })

    it('adds and removes a role, always in the same order and never twice', () =>
    {
        expect(withRole(['admin', 'employee'], 'engineer')).toEqual(['employee', 'engineer', 'admin'])
        expect(withRole(['employee', 'engineer'], 'engineer')).toEqual(['employee', 'engineer'])
        expect(withoutRole(['employee', 'engineer', 'admin'], 'engineer')).toEqual(['employee', 'admin'])
        expect(withoutRole(['employee'], 'engineer')).toEqual(['employee'])
    })
})
