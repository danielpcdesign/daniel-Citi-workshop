import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() =>
{
    cleanup()
    globalThis.__screenWidth = undefined
})

// jsdom has no matchMedia. react-responsive captures the function at import, so tests change the
// simulated width (globalThis.__screenWidth) rather than replacing the function
function matchesWidth(query)
{
    const width = globalThis.__screenWidth || 1280
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
}

if (!window.matchMedia)
{
    window.matchMedia = (query) => ({
        matches: matchesWidth(query),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
    })
}
