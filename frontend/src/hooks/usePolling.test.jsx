import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePolling } from './usePolling.js'

function setVisibility(state)
{
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() =>
{
    vi.useFakeTimers()
    setVisibility('visible')
})

afterEach(() =>
{
    vi.useRealTimers()
    setVisibility('visible')
})

describe('usePolling', () =>
{
    it('loads at once, then on every interval while visible', async () =>
    {
        const loader = vi.fn().mockResolvedValue({ n: 1 })
        const { result } = renderHook(() => usePolling(loader, 1000))
        expect(result.current.loading).toBe(true)
        await act(async () => undefined)
        expect(result.current.data).toEqual({ n: 1 })
        expect(result.current.loading).toBe(false)
        expect(loader).toHaveBeenCalledTimes(1)

        await act(async () => vi.advanceTimersByTime(3000))
        expect(loader).toHaveBeenCalledTimes(4)
    })

    it('pauses while hidden and reloads on return', async () =>
    {
        const loader = vi.fn().mockResolvedValue({})
        renderHook(() => usePolling(loader, 1000))
        await act(async () => undefined)
        act(() => setVisibility('hidden'))
        await act(async () => vi.advanceTimersByTime(5000))
        expect(loader).toHaveBeenCalledTimes(1)

        await act(async () => setVisibility('visible'))
        expect(loader).toHaveBeenCalledTimes(2)
        await act(async () => vi.advanceTimersByTime(1000))
        expect(loader).toHaveBeenCalledTimes(3)
    })

    it('does not start polling when mounted in a hidden tab', async () =>
    {
        setVisibility('hidden')
        const loader = vi.fn().mockResolvedValue({})
        renderHook(() => usePolling(loader, 1000))
        await act(async () => vi.advanceTimersByTime(5000))
        expect(loader).toHaveBeenCalledTimes(1)
    })

    it('keeps the last data when a refresh fails', async () =>
    {
        const failure = new Error('down')
        const loader = vi.fn().mockResolvedValueOnce({ n: 1 }).mockRejectedValueOnce(failure)
        const { result } = renderHook(() => usePolling(loader, 1000))
        await act(async () => undefined)
        await act(async () => vi.advanceTimersByTime(1000))
        expect(result.current.data).toEqual({ n: 1 })
        expect(result.current.error).toBe(failure)
    })

    it('ignores a slow answer that a newer call overtook', async () =>
    {
        let resolveSlow
        const loader = vi.fn()
            .mockImplementationOnce(() => new Promise((resolve) =>
            {
                resolveSlow = resolve
            }))
            .mockResolvedValueOnce({ n: 'new' })
        const { result } = renderHook(() => usePolling(loader, 1000))
        await act(async () => result.current.reload())
        await act(async () => resolveSlow({ n: 'old' }))
        expect(result.current.data).toEqual({ n: 'new' })
    })

    it('stops on unmount', async () =>
    {
        const loader = vi.fn().mockResolvedValue({})
        const { unmount } = renderHook(() => usePolling(loader, 1000))
        await act(async () => undefined)
        unmount()
        await act(async () => vi.advanceTimersByTime(5000))
        expect(loader).toHaveBeenCalledTimes(1)
    })

    it('with no interval, loads once and then only on request, even on return to the tab', async () =>
    {
        const loader = vi.fn().mockResolvedValue({ n: 1 })
        const { result, unmount } = renderHook(() => usePolling(loader, null))
        await act(async () => undefined)
        await act(async () => vi.advanceTimersByTime(60000))
        setVisibility('hidden')
        setVisibility('visible')
        expect(loader).toHaveBeenCalledTimes(1)
        await act(async () => result.current.reload())
        expect(loader).toHaveBeenCalledTimes(2)
        unmount()
    })
})
