import Alert from '@mui/material/Alert'

const KNOWN = {
    network: 'Could not reach the server. Check your connection and try again.',
    forbidden: 'You do not have permission to do that.',
    not_found: 'That could not be found. It may have been removed, or you may not have access to it.',
    unauthenticated: 'Your session has ended. Sign in again to continue.',
}

// expected failures read as direction; unexpected ones carry the request id so support can find the log line (AD-12)
export default function ErrorNotice({ error, action, sx })
{
    if (!error)
    {
        return null
    }
    const known = KNOWN[error.code]
    const expected = Boolean(known) || error.code === 'validation_failed' || error.code === 'conflict' || error.code === 'bad_request'
    const text = expected ? (known || error.message) : 'Something went wrong on our side. Try again in a moment.'
    return (
        <Alert severity="error" action={action} sx={sx}>
            {text}
            {!expected && error.requestId && (
                <>
                    {' '}Quote reference <strong>{error.requestId}</strong> if you contact support.
                </>
            )}
        </Alert>
    )
}
