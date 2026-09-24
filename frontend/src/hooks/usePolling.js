import { useCallback, useEffect, useRef, useState } from 'react'

// load now, then every intervalMs while the tab is visible; reload on return to the tab (AD-14)
// the loader's identity is the dependency: wrap it in useCallback with what it reads
// intervalMs null: load once and on reload() only, for reports AD-14 keeps on demand (timings, hotspots)
export function usePolling(loader, intervalMs)
{
    // which loader produced the current result: a new loader (next page, other ticket) means "loading" until it answers
    const [result, setResult] = useState({ loader: null, data: null, error: null })
    const latestCall = useRef(0)

    const reload = useCallback(async () =>
    {
        const call = latestCall.current + 1
        latestCall.current = call
        try
        {
            const data = await loader()
            // an older, slower response must not overwrite a newer one
            if (call === latestCall.current)
            {
                setResult({ loader, data, error: null })
            }
        }
        catch (error)
        {
            if (call === latestCall.current)
            {
                // keep what was on screen; say that the refresh failed
                setResult((previous) => ({ loader, data: previous.data, error }))
            }
        }
    }, [loader])

    useEffect(() =>
    {
        let timer = null
        const start = () =>
        {
            if (timer === null)
            {
                timer = setInterval(reload, intervalMs)
            }
        }
        const stop = () =>
        {
            clearInterval(timer)
            timer = null
        }
        const onVisibility = () =>
        {
            if (document.visibilityState === 'visible')
            {
                reload()
                start()
            }
            else
            {
                stop()
            }
        }

        reload()
        if (!intervalMs)
        {
            return () =>
            {
                latestCall.current += 1
            }
        }
        if (document.visibilityState === 'visible')
        {
            start()
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () =>
        {
            stop()
            document.removeEventListener('visibilitychange', onVisibility)
            // late answers from this loader are ignored
            latestCall.current += 1
        }
    }, [reload, intervalMs])

    return {
        data: result.data,
        error: result.error,
        loading: result.loader !== loader,
        reload,
    }
}
