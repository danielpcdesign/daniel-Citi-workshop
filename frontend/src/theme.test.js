import { describe, expect, it } from 'vitest'
import { buildTheme, statusColorValues, tokenValues, tokens } from './theme.js'

describe('theme', () =>
{
    it('gives components css variables, so they follow the active theme', () =>
    {
        expect(tokens.plate).toBe('var(--acme-plate)')
        expect(tokens.signalRed).toBe('var(--acme-signalRed)')
        expect(Object.keys(tokens)).toEqual(Object.keys(tokenValues('dark', 'safe')))
    })

    it('has a real dark variant: dark page, lifted plate, lighter marks, lighter signals', () =>
    {
        const light = tokenValues('light')
        const dark = tokenValues('dark')
        expect(dark.paper).not.toBe(light.paper)
        expect(dark.plate).not.toBe(light.plate)
        expect(dark.mark).not.toBe(dark.plate)
        expect(dark.signalRed).not.toBe(light.signalRed)
        const theme = buildTheme({ mode: 'dark' })
        expect(theme.palette.mode).toBe('dark')
        expect(theme.palette.background.default).toBe(dark.paper)
        expect(theme.components.MuiCssBaseline.styleOverrides[':root']['--acme-plate']).toBe(dark.plate)
        expect(theme.components.MuiCssBaseline.styleOverrides[':root'].colorScheme).toBe('dark')
    })

    it('swaps red and amber for Okabe-Ito vermillion and blue in the colour-blind safe palette', () =>
    {
        expect(tokenValues('light', 'safe').signalRed).toBe('#A94700')
        expect(tokenValues('light', 'safe').signalAmber).toBe('#005A96')
        expect(statusColorValues('light', 'safe')).toEqual({
            unassigned: '#E69F00', open: '#56B4E9', in_progress: '#0072B2', blocked: '#D55E00', resolved: '#009E73', closed: '#BBBBBB',
        })
        const theme = buildTheme({ palette: 'safe' })
        expect(theme.palette.error.main).toBe('#A94700')
        expect(theme.acme.status.blocked).toBe('#D55E00')
    })

    it('stops every transition when motion is reduced, and leaves them alone otherwise', () =>
    {
        const still = buildTheme({ reducedMotion: true })
        expect(still.transitions.create('opacity')).toBe('none')
        expect(still.components.MuiCssBaseline.styleOverrides['*, *::before, *::after'].transitionDuration).toBe('0.01ms !important')
        const moving = buildTheme()
        expect(moving.transitions.create('opacity')).not.toBe('none')
        expect(moving.components.MuiCssBaseline.styleOverrides['*, *::before, *::after']).toBeUndefined()
    })

    it('falls back to the light standard set for unknown choices', () =>
    {
        expect(tokenValues('sepia', 'neon')).toEqual(tokenValues('light', 'standard'))
        expect(statusColorValues('sepia', 'neon')).toEqual(statusColorValues('light', 'standard'))
    })
})
