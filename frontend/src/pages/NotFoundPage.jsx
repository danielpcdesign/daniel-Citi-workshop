import { Link as RouterLink } from 'react-router-dom'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'

export default function NotFoundPage()
{
    return (
        <>
            <Typography variant="h2" component="h1" sx={{ mb: 2 }}>There is no page here</Typography>
            <Typography>
                Check the address, or go to <Link component={RouterLink} to="/tickets">your tickets</Link>.
            </Typography>
        </>
    )
}
