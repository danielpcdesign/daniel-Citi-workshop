import { afterEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useActiveSection } from './useActiveSection.js'

const IDS = ['one', 'two', 'two-child']

function Probe()
{
    const [active] = useActiveSection(IDS)
    return (
        <>
            {IDS.map((id) => <div key={id} id={id} />)}
            <p data-testid="active">{active}</p>
        </>
    )
}

let observer

// stands in for the browser: the test says which sections are on screen
class FakeObserver
{
    constructor(callback)
    {
        this.callback = callback
        this.observed = []
        this.disconnected = false
        observer = this
    }

    observe(element)
    {
        this.observed.push(element.id)
    }

    disconnect()
    {
        this.disconnected = true
    }

    show(changes)
    {
        this.callback(Object.entries(changes).map(([id, isIntersecting]) => ({ target: { id }, isIntersecting })))
    }
}

afterEach(() =>
{
    delete globalThis.IntersectionObserver
})

describe('useActiveSection', () =>
{
    it('starts on the first section when the browser cannot observe', () =>
    {
        render(<Probe />)
        expect(screen.getByTestId('active')).toHaveTextContent('one')
    })

    it('follows the scroll, preferring the deepest section in view', () =>
    {
        globalThis.IntersectionObserver = FakeObserver
        const { unmount } = render(<Probe />)
        expect(observer.observed).toEqual(IDS)

        act(() => observer.show({ two: true }))
        expect(screen.getByTestId('active')).toHaveTextContent(/^two$/)
        act(() => observer.show({ 'two-child': true }))
        expect(screen.getByTestId('active')).toHaveTextContent('two-child')
        act(() => observer.show({ 'two-child': false, two: false }))
        // nothing in the band: the last known section stays marked
        expect(screen.getByTestId('active')).toHaveTextContent('two-child')
        act(() => observer.show({ one: true }))
        expect(screen.getByTestId('active')).toHaveTextContent('one')

        unmount()
        expect(observer.disconnected).toBe(true)
    })
})
