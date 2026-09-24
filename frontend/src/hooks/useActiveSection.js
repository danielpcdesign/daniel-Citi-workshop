import { useEffect, useState } from 'react'

// which section is in the upper part of the viewport, for the dashboard nav's "you are here" mark
// ids in page order; a nested section comes after its parent, so the deepest visible one wins
export function useActiveSection(ids)
{
    const [active, setActive] = useState(ids[0])
    const key = ids.join(' ')

    useEffect(() =>
    {
        // jsdom and very old browsers: the nav still works, it just does not follow the scroll
        if (typeof IntersectionObserver === 'undefined')
        {
            return undefined
        }
        const order = key.split(' ')
        const visible = new Set()
        const observer = new IntersectionObserver((entries) =>
        {
            for (const entry of entries)
            {
                if (entry.isIntersecting)
                {
                    visible.add(entry.target.id)
                }
                else
                {
                    visible.delete(entry.target.id)
                }
            }
            const shown = order.filter((id) => visible.has(id))
            if (shown.length)
            {
                setActive(shown[shown.length - 1])
            }
        }, { rootMargin: '-15% 0px -55% 0px' })

        for (const id of order)
        {
            const element = document.getElementById(id)
            if (element)
            {
                observer.observe(element)
            }
        }
        return () => observer.disconnect()
    }, [key])

    return [active, setActive]
}
