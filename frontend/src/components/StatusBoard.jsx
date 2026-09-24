import { useMediaQuery } from 'react-responsive'
import Box from '@mui/material/Box'
import BoardColumn from './BoardColumn.jsx'
import { MOBILE_QUERY } from './AppShell.jsx'

// every status side by side in workflow order: what is open, and what is stuck (AD-18)
// on a phone the columns scroll sideways one at a time rather than squeezing six into 375px
export default function StatusBoard({ columns })
{
    const isMobile = useMediaQuery({ query: MOBILE_QUERY })
    return (
        <Box
            data-layout={isMobile ? 'scroll' : 'grid'}
            sx={{
                // positioned, so the cards' absolutely placed screen-reader text is clipped by this scroller, not the page
                position: 'relative',
                display: 'grid',
                gridAutoFlow: 'column',
                gridAutoColumns: isMobile ? '80%' : 'minmax(164px, 1fr)',
                gap: 1.5,
                overflowX: 'auto',
                scrollSnapType: isMobile ? 'x mandatory' : 'none',
                pb: 1,
                alignItems: 'start',
            }}
        >
            {columns.map((column) => (
                <BoardColumn key={column.status} status={column.status} items={column.items} total={column.total} />
            ))}
        </Box>
    )
}
