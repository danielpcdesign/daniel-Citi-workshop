import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, cleanSettings, loadSettings, saveSettings } from './settings.js'

afterEach(() =>
{
    window.localStorage.clear()
})

describe('settings storage', () =>
{
    it('starts on the defaults: follow the device for appearance and motion, standard colours', () =>
    {
        expect(DEFAULT_SETTINGS).toEqual({ appearance: 'system', palette: 'standard', motion: 'system' })
        expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    })

    it('keeps what was saved', () =>
    {
        expect(saveSettings({ appearance: 'dark', palette: 'safe', motion: 'reduce' })).toBe(true)
        expect(loadSettings()).toEqual({ appearance: 'dark', palette: 'safe', motion: 'reduce' })
    })

    it('replaces anything unknown with that setting\'s default, and keeps the rest', () =>
    {
        expect(cleanSettings({ appearance: 'sepia', palette: 'safe', extra: 1 })).toEqual({ appearance: 'system', palette: 'safe', motion: 'system' })
        expect(cleanSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
        window.localStorage.setItem('acme.settings', '{not json')
        expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    })

    it('runs on the defaults when storage cannot be read', () =>
    {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() =>
        {
            throw new Error('SecurityError')
        })
        expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    })

    it('says so when storage cannot be written, without throwing', () =>
    {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() =>
        {
            throw new Error('QuotaExceededError')
        })
        expect(saveSettings({ appearance: 'dark' })).toBe(false)
    })
})
