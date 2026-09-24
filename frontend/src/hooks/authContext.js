import { createContext } from 'react'

// { status: 'loading' | 'ready', user, signIn, register, signOut }
export const AuthContext = createContext(null)
