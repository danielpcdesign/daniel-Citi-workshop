import { createContext } from 'react'

// { status: 'loading' | 'ready', user, signIn, register, signOut, switchRole }
// user.role is the active role; user.roles every role held (employee always among them)
export const AuthContext = createContext(null)
