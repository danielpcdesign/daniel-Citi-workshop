import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { radius, tokens } from '../theme.js'

// a dashboard section that starts closed; the page owns `expanded` so the section nav can open it
// id is the nav's anchor; the root takes focus after a jump so the keyboard carries on from there
// onOpened fires once the open animation has finished, when the section's final position is known
export default function CollapsibleSection({ id, title, hint, icon, expanded, onToggle, onOpened, headingComponent = 'h2', titleVariant = 'h4', children, sx })
{
    return (
        <Accordion
            id={id}
            tabIndex={-1}
            expanded={expanded}
            onChange={(event, open) => onToggle(open)}
            disableGutters
            elevation={0}
            slotProps={{ heading: { component: headingComponent }, transition: { onEntered: onOpened } }}
            sx={[
                {
                    border: `1px solid ${tokens.rule}`,
                    borderRadius: `${radius.surface}px`,
                    '&:first-of-type, &:last-of-type': { borderRadius: `${radius.surface}px` },
                    '&::before': { display: 'none' },
                    '&:focus': { outline: 'none' },
                    scrollMarginTop: { xs: 64, md: 16 },
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            <AccordionSummary
                id={`${id}-summary`}
                aria-controls={`${id}-content`}
                expandIcon={<ExpandMoreIcon />}
                sx={{ px: { xs: 2, md: 3 }, py: 1, '& .MuiAccordionSummary-content': { my: 1, minWidth: 0 } }}
            >
                <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                    {icon}
                    <Box component="span" sx={{ minWidth: 0 }}>
                        <Typography component="span" variant={titleVariant} sx={{ display: 'block' }}>{title}</Typography>
                        {hint && <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>{hint}</Typography>}
                    </Box>
                </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ px: { xs: 2, md: 3 }, pb: { xs: 2, md: 3 }, pt: 0 }}>
                {children}
            </AccordionDetails>
        </Accordion>
    )
}
