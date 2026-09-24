import { useEffect, useState } from 'react'

// the value once it has stopped changing for delayMs: one request per pause in typing, not per keystroke
export function useDebounced(value, delayMs)
{
    const [settled, setSettled] = useState(value)

    useEffect(() =>
    {
        const timer = setTimeout(() => setSettled(value), delayMs)
        return () => clearTimeout(timer)
    }, [value, delayMs])

    return settled
}
