import { expect, it, vi } from 'vitest'
import { hardNavigate } from './browser.js'

it('loads the page afresh', () =>
{
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    hardNavigate('/signin')
    expect(assign).toHaveBeenCalledWith('/signin')
    vi.unstubAllGlobals()
})
