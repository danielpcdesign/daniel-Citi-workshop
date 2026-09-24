import { useId, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { MOBILE_QUERY } from './AppShell.jsx'
import { fmtAgo, fmtDateTime, fmtStatus } from '../utils/format.js'
import { srOnly, tokens } from '../theme.js'

// on a phone the newest few moves are what the reader came for; the rest sit behind one tap
export const PHONE_VISIBLE = 3

// red is kept for meaning only: blocked is the one status that signals trouble (AD-18)
function StatusName({ status })
{
    return (
        <Box component="span" sx={{ color: status === 'blocked' ? 'error.main' : 'text.primary' }}>
            {fmtStatus(status)}
        </Box>
    )
}

function MoveLabel({ entry })
{
    if (!entry.from)
    {
        return 'Reported'
    }
    return (
        <>
            <StatusName status={entry.from} />
            <Box component="span" aria-hidden="true" sx={{ mx: 0.75, color: 'text.secondary' }}>→</Box>
            <Box component="span" sx={srOnly}> to </Box>
            <StatusName status={entry.to} />
        </>
    )
}

// history rows record the holder after every move; only a change of hands is worth a line
function withHolderChange(history)
{
    return history.map((entry, index) =>
    {
        const before = index === 0 ? null : history[index - 1].assignee_id ?? null
        return { entry, holderChanged: (entry.assignee_id ?? null) !== before }
    })
}

// every status change on the ticket, newest first, read from the detail response it polls with (AD-17, M12)
// title and headingComponent let the dashboard name the ticket and nest the heading under its own sections
export default function HistoryTimeline({ history, now, sx, title = 'History', headingComponent = 'h2' })
{
    const isMobile = useMediaQuery({ query: MOBILE_QUERY })
    const [expanded, setExpanded] = useState(false)
    const listId = useId()

    if (!Array.isArray(history) || history.length === 0)
    {
        return null
    }

    // the api sends oldest first; the holder comparison needs that order, the reader wants the latest on top
    const rows = withHolderChange(history).reverse()
    const collapsible = isMobile && rows.length > PHONE_VISIBLE
    const shown = collapsible && !expanded ? rows.slice(0, PHONE_VISIBLE) : rows
    const moves = rows.length === 1 ? '1 change' : `${rows.length} changes`

    return (
        <Paper variant="outlined" component="section" aria-labelledby="history-heading" sx={[{ p: { xs: 2, md: 3 } }, sx]}>
            <Typography id="history-heading" variant="h5" component={headingComponent}>{title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Every status change on this ticket, latest first.
            </Typography>

            <Box component="ol" id={listId} aria-label="Status changes" sx={{ m: 0, p: 0 }}>
                {shown.map(({ entry, holderChanged }, index) =>
                {
                    const blocked = entry.to === 'blocked'
                    const last = index === shown.length - 1
                    return (
                        <Box
                            component="li"
                            key={`${entry.at}-${entry.to}-${index}`}
                            sx={{
                                listStyle: 'none',
                                position: 'relative',
                                pl: 3.5,
                                pb: last ? 0 : 2.5,
                                // the rail joins one marker to the next, like a route on a floor plan
                                '&::before': last
                                    ? undefined
                                    : { content: '""', position: 'absolute', left: 5, top: 18, bottom: 0, width: 2, bgcolor: tokens.rule },
                            }}
                        >
                            <Box
                                aria-hidden="true"
                                sx={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 5,
                                    width: 12,
                                    height: 12,
                                    borderRadius: '3px',
                                    bgcolor: blocked ? tokens.signalRed : tokens.plate,
                                    // the ticket's current position is solid; earlier moves are outlines
                                    ...(index > 0 && { bgcolor: tokens.surface, border: `2px solid ${blocked ? tokens.signalRed : tokens.plate}` }),
                                }}
                            />
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 2 }}>
                                <Typography component="p" variant="h6">
                                    <MoveLabel entry={entry} />
                                </Typography>
                                <Typography
                                    component="time"
                                    variant="caption"
                                    color="text.secondary"
                                    dateTime={entry.at}
                                >
                                    {fmtDateTime(entry.at)}, {fmtAgo(entry.at, now)}
                                </Typography>
                            </Box>
                            <Typography variant="body2" color="text.secondary">by {entry.actor_name}</Typography>
                            {holderChanged && (
                                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    {entry.assignee_name ? `Assigned to ${entry.assignee_name}` : 'Unassigned'}
                                </Typography>
                            )}
                            {entry.reason && (
                                <Typography
                                    variant="body2"
                                    sx={{
                                        mt: 0.5,
                                        pl: 1.25,
                                        borderLeft: `3px solid ${blocked ? tokens.signalRed : tokens.rule}`,
                                        whiteSpace: 'pre-wrap',
                                        overflowWrap: 'anywhere',
                                        maxWidth: '65ch',
                                    }}
                                >
                                    {entry.reason}
                                </Typography>
                            )}
                        </Box>
                    )
                })}
            </Box>

            {collapsible && (
                <Button
                    size="small"
                    sx={{ mt: 1.5, ml: 2.5 }}
                    aria-expanded={expanded}
                    aria-controls={listId}
                    onClick={() => setExpanded((open) => !open)}
                >
                    {expanded ? 'Show the latest only' : `Show all ${moves}`}
                </Button>
            )}
        </Paper>
    )
}
