import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SignInPage from './SignInPage.jsx'
import RegisterPage from './RegisterPage.jsx'
import { ApiError } from '../services/http.js'
import { fakeAuth, renderPage } from '../test/render.jsx'

describe('SignInPage', () =>
{
    it('signs in and goes where the user was heading', async () =>
    {
        const user = userEvent.setup()
        const signIn = vi.fn().mockResolvedValue({})
        renderPage(<SignInPage />, { route: '/signin', auth: fakeAuth({ user: null, signIn }), state: { from: '/incidents/3' } })
        const button = screen.getByRole('button', { name: 'Sign in' })
        expect(button).toBeDisabled()
        await user.type(screen.getByLabelText(/Work email/), ' emp@acme.inc ')
        await user.type(screen.getByLabelText(/Password/), 'a long enough password')
        await user.click(button)
        expect(signIn).toHaveBeenCalledWith('emp@acme.inc', 'a long enough password')
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/incidents/3'))
    })

    it('takes an admin to the dashboard when they were not heading anywhere', async () =>
    {
        const user = userEvent.setup()
        const signIn = vi.fn().mockResolvedValue({ id: 1, role: 'admin' })
        renderPage(<SignInPage />, { route: '/signin', auth: fakeAuth({ user: null, signIn }) })
        await user.type(screen.getByLabelText(/Work email/), 'adm@acme.inc')
        await user.type(screen.getByLabelText(/Password/), 'a long enough password')
        await user.click(screen.getByRole('button', { name: 'Sign in' }))
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/dashboard'))
    })

    it('says plainly when the credentials do not match', async () =>
    {
        const user = userEvent.setup()
        const signIn = vi.fn().mockRejectedValue(new ApiError({ status: 401, code: 'unauthenticated', message: 'invalid email or password' }))
        renderPage(<SignInPage />, { auth: fakeAuth({ user: null, signIn }) })
        await user.type(screen.getByLabelText(/Work email/), 'x@acme.inc')
        await user.type(screen.getByLabelText(/Password/), 'wrong')
        await user.click(screen.getByRole('button', { name: 'Sign in' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('That email and password do not match an account.')
        expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    })

    it('shows a boot problem', () =>
    {
        renderPage(<SignInPage />, { auth: fakeAuth({ user: null, bootError: new ApiError({ status: 0, code: 'network', message: 'x' }) }) })
        expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server')
    })
})

describe('RegisterPage', () =>
{
    async function fill(user)
    {
        await user.type(screen.getByLabelText(/Full name/), 'Erin')
        await user.type(screen.getByLabelText(/Work email/), 'erin@gmail.com')
        await user.type(screen.getByLabelText(/Password/), 'short')
        await user.click(screen.getByRole('button', { name: 'Create account' }))
    }

    it('shows the server field messages beside each input', async () =>
    {
        const user = userEvent.setup()
        const register = vi.fn().mockRejectedValue(new ApiError({
            status: 400,
            code: 'validation_failed',
            message: '2 field(s) invalid',
            fields: { email: 'Value error, must be an @acme.inc address', password: 'Value error, must be at least 12 characters' },
        }))
        renderPage(<RegisterPage />, { auth: fakeAuth({ user: null, register }) })
        await fill(user)
        expect(await screen.findByText('Must be an @acme.inc address')).toBeInTheDocument()
        expect(screen.getByText('Must be at least 12 characters')).toBeInTheDocument()
        expect(screen.getByLabelText(/Work email/)).toHaveAttribute('aria-invalid', 'true')
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(register).toHaveBeenCalledWith({ fullName: 'Erin', email: 'erin@gmail.com', password: 'short' })
    })

    it('caps the name at the server\'s length and shows the server\'s name rule beside it', async () =>
    {
        const user = userEvent.setup()
        const register = vi.fn().mockRejectedValue(new ApiError({
            status: 400,
            code: 'validation_failed',
            message: 'invalid',
            fields: { full_name: 'Value error, must contain at least one letter' },
        }))
        renderPage(<RegisterPage />, { auth: fakeAuth({ user: null, register }) })
        const name = screen.getByLabelText(/Full name/)
        expect(name).toHaveAttribute('maxLength', '100')
        expect(screen.getByText('Your name as colleagues know it')).toBeInTheDocument()
        await fill(user)
        expect(await screen.findByText('Must contain at least one letter')).toBeInTheDocument()
        expect(name).toHaveAttribute('aria-invalid', 'true')
    })

    it('explains a duplicate email beside the email input', async () =>
    {
        const user = userEvent.setup()
        const register = vi.fn().mockRejectedValue(new ApiError({ status: 409, code: 'conflict', message: 'email already registered' }))
        renderPage(<RegisterPage />, { auth: fakeAuth({ user: null, register }) })
        await fill(user)
        expect(await screen.findByText(/already exists/)).toBeInTheDocument()
    })

    it('goes to my tickets after registering', async () =>
    {
        const user = userEvent.setup()
        renderPage(<RegisterPage />, { auth: fakeAuth({ user: null }) })
        await fill(user)
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/tickets'))
    })
})
