import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AuthCard from '../components/AuthCard.jsx'
import ErrorNotice from '../components/ErrorNotice.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { fieldError, unplacedError } from '../utils/errors.js'

const FIELDS = ['full_name', 'email', 'password']

export default function RegisterPage()
{
    const { register } = useAuth()
    const navigate = useNavigate()
    const [form, setForm] = useState({ fullName: '', email: '', password: '' })
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)

    const update = (name) => (event) => setForm({ ...form, [name]: event.target.value })

    const handleSubmit = async (event) =>
    {
        event.preventDefault()
        setBusy(true)
        setError(null)
        try
        {
            await register({ fullName: form.fullName.trim(), email: form.email.trim(), password: form.password })
            navigate('/tickets', { replace: true })
        }
        catch (registerError)
        {
            setError(registerError)
            setBusy(false)
        }
    }

    // the domain and password rules are the server's (AD-21); the form only checks that something was typed
    const emailError = fieldError(error, 'email') || (error?.code === 'conflict' ? 'An account with this email already exists. Sign in instead.' : null)
    const general = error?.code === 'conflict' ? null : unplacedError(error, FIELDS)

    return (
        <AuthCard title="Create an account" intro="Use your acme.inc email address. New accounts can report and follow problems.">
            <form onSubmit={handleSubmit} noValidate>
                <Stack spacing={2.5}>
                    <ErrorNotice error={general} />
                    <TextField
                        label="Full name"
                        autoComplete="name"
                        value={form.fullName}
                        onChange={update('fullName')}
                        error={Boolean(fieldError(error, 'full_name'))}
                        helperText={fieldError(error, 'full_name')}
                        required
                        disabled={busy}
                    />
                    <TextField
                        label="Work email"
                        type="email"
                        autoComplete="email"
                        value={form.email}
                        onChange={update('email')}
                        error={Boolean(emailError)}
                        helperText={emailError || 'Must end in @acme.inc'}
                        required
                        disabled={busy}
                    />
                    <TextField
                        label="Password"
                        type="password"
                        autoComplete="new-password"
                        value={form.password}
                        onChange={update('password')}
                        error={Boolean(fieldError(error, 'password'))}
                        helperText={fieldError(error, 'password') || 'At least 12 characters. A short phrase works well.'}
                        required
                        disabled={busy}
                    />
                    <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        disabled={busy || !form.fullName.trim() || !form.email.trim() || !form.password}
                    >
                        {busy ? 'Creating account' : 'Create account'}
                    </Button>
                    <Typography variant="body2">
                        Already have an account? <Link component={RouterLink} to="/signin">Sign in</Link>
                    </Typography>
                </Stack>
            </form>
        </AuthCard>
    )
}
