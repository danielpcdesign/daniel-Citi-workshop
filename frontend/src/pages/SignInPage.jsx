import { useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AuthCard from '../components/AuthCard.jsx'
import ErrorNotice from '../components/ErrorNotice.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { homePath } from '../utils/roles.js'

export default function SignInPage()
{
    const { signIn, bootError } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)

    const handleSubmit = async (event) =>
    {
        event.preventDefault()
        setBusy(true)
        setError(null)
        try
        {
            const user = await signIn(email.trim(), password)
            navigate(location.state?.from || homePath(user), { replace: true })
        }
        catch (signInError)
        {
            setError(signInError)
            setBusy(false)
        }
    }

    // a wrong password is a 401 too; say it plainly instead of "session ended"
    const shown = error && error.status === 401
        ? { ...error, code: 'bad_request', message: 'That email and password do not match an account.' }
        : error

    return (
        <AuthCard title="Sign in" intro="Report a problem at work and follow it until it is fixed.">
            <form onSubmit={handleSubmit} noValidate>
                <Stack spacing={2.5}>
                    <ErrorNotice error={shown || bootError} />
                    <TextField
                        label="Work email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        disabled={busy}
                    />
                    <TextField
                        label="Password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        disabled={busy}
                    />
                    <Button type="submit" variant="contained" size="large" disabled={busy || !email.trim() || !password}>
                        {busy ? 'Signing in' : 'Sign in'}
                    </Button>
                    <Typography variant="body2">
                        New here? <Link component={RouterLink} to="/register">Create an account</Link>
                    </Typography>
                </Stack>
            </form>
        </AuthCard>
    )
}
