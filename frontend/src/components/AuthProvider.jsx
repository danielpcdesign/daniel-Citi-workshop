import { useCallback, useEffect, useMemo, useState } from 'react'
import { AuthContext } from '../hooks/authContext.js'
import { setSessionListener } from '../services/http.js'
import * as authService from '../services/authService.js'

export default function AuthProvider({ children })
{
    const [session, setSession] = useState({ status: 'loading', user: null, bootError: null })

    useEffect(() =>
    {
        let active = true
        // a refresh anywhere (including a retry after 401) updates the user; a failed one signs out
        setSessionListener((next) =>
        {
            setSession({ status: 'ready', user: next ? next.user : null, bootError: null })
        })
        // StrictMode runs this twice; refreshSession's shared promise makes it one POST (AD-06)
        authService.restoreSession()
            .then((user) =>
            {
                if (active)
                {
                    setSession({ status: 'ready', user, bootError: null })
                }
            })
            .catch((error) =>
            {
                if (active)
                {
                    // 401 simply means "not signed in"; anything else is worth saying
                    setSession({ status: 'ready', user: null, bootError: error.status === 401 ? null : error })
                }
            })
        return () =>
        {
            active = false
            setSessionListener(null)
        }
    }, [])

    const signIn = useCallback(async (email, password) =>
    {
        const user = await authService.login(email, password)
        setSession({ status: 'ready', user, bootError: null })
        return user
    }, [])

    const register = useCallback(async ({ fullName, email, password }) =>
    {
        await authService.register({ fullName, email, password })
        return signIn(email, password)
    }, [signIn])

    const signOut = useCallback(async () =>
    {
        try
        {
            await authService.signOut()
        }
        finally
        {
            setSession({ status: 'ready', user: null, bootError: null })
        }
    }, [])

    const value = useMemo(
        () => ({ ...session, signIn, register, signOut }),
        [session, signIn, register, signOut],
    )

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
