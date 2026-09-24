import { useCallback, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import Pagination from '@mui/material/Pagination'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import BoardCard from './BoardCard.jsx'
import ErrorNotice from './ErrorNotice.jsx'
import PageLoader from './PageLoader.jsx'
import { MOBILE_QUERY } from './AppShell.jsx'
import { usePolling } from '../hooks/usePolling.js'
import { listIncidents } from '../services/incidentService.js'
import { radius, tokens } from '../theme.js'

export const DRAWER_PAGE_SIZE = 20

// the tickets behind one summary figure; mounted per figure, so its page starts at 1 every time
function DrawerBody({ figure, headingId, onClose })
{
    const [page, setPage] = useState(1)
    // the server scopes the list exactly as it scoped the count: an engineer sees their own (AD-09)
    const load = useCallback(() => listIncidents({ ...figure.query, page, limit: DRAWER_PAGE_SIZE }), [figure, page])
    const tickets = usePolling(load, null)
    const data = tickets.data
    const total = data ? data.total : figure.count
    const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

    return (
        <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 2.5, py: 1.5, borderBottom: `1px solid ${tokens.rule}` }}>
                <Typography id={headingId} variant="h4" component="h2">
                    {figure.label} ({total})
                </Typography>
                <IconButton aria-label="Close" onClick={onClose} edge="end">
                    <CloseIcon />
                </IconButton>
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, py: 2 }}>
                <ErrorNotice
                    error={tickets.error}
                    sx={{ mb: 2 }}
                    action={<Button color="inherit" size="small" onClick={tickets.reload}>Try again</Button>}
                />
                {tickets.loading && !data && <PageLoader label="Loading the tickets" />}
                {data && data.total === 0 && <Typography>No tickets here right now.</Typography>}
                {data && data.items.length > 0 && (
                    <Box
                        component="ul"
                        aria-label={`${figure.label} tickets`}
                        sx={{ m: 0, p: 0, display: 'grid', gap: 1, opacity: tickets.loading ? 0.6 : 1 }}
                    >
                        {data.items.map((incident) => (
                            <BoardCard key={incident.id} incident={incident} blocked={incident.status === 'blocked'} showStatus />
                        ))}
                    </Box>
                )}
            </Box>
            {data && pages > 1 && (
                <Box sx={{ px: 2.5, py: 1.5, borderTop: `1px solid ${tokens.rule}` }}>
                    <Pagination count={pages} page={page} onChange={(event, next) => setPage(next)} shape="rounded" size="small" />
                </Box>
            )}
        </>
    )
}

// right-hand panel on a desktop, a bottom sheet on a phone; Escape or Close returns focus to the figure (MUI Modal)
// figure stays set while the drawer slides shut, so it closes with its content; opening is a new body (page 1, fresh load)
export default function TicketDrawer({ figure, opening, open, onClose })
{
    const isMobile = useMediaQuery({ query: MOBILE_QUERY })
    const headingId = 'ticket-drawer-heading'
    return (
        <Drawer
            anchor={isMobile ? 'bottom' : 'right'}
            open={open}
            onClose={onClose}
            slotProps={{
                paper: {
                    role: 'dialog',
                    'aria-modal': true,
                    'aria-labelledby': headingId,
                    sx: isMobile
                        ? { height: '85vh', borderRadius: `${radius.plate}px ${radius.plate}px 0 0`, display: 'flex', flexDirection: 'column' }
                        : { width: 460, maxWidth: '100vw', display: 'flex', flexDirection: 'column', borderRadius: 0 },
                },
            }}
        >
            {figure && <DrawerBody key={opening} figure={figure} headingId={headingId} onClose={onClose} />}
        </Drawer>
    )
}
