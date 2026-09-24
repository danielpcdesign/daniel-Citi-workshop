import { useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import { tokens } from '../theme.js'

function go(event, id, onGo)
{
    // the page decides: a collapsed target is opened before it is scrolled to
    event.preventDefault()
    onGo(id)
}

// like a building directory: a rail with the current section marked on it, children branching off it
function DirectoryEntry({ entry, active, onGo, nested })
{
    const current = active === entry.id
    return (
        <Box
            component="a"
            href={`#${entry.id}`}
            aria-current={current ? 'location' : undefined}
            onClick={(event) => go(event, entry.id, onGo)}
            sx={{
                position: 'relative',
                display: 'block',
                ml: '-2px',
                py: 0.75,
                pl: nested ? 4 : 2,
                pr: 1,
                borderLeft: `4px solid ${current ? tokens.mark : 'transparent'}`,
                color: current ? tokens.ink : tokens.muted,
                fontWeight: current ? 700 : 400,
                lineHeight: 1.35,
                textDecoration: 'none',
                '&:hover': { color: tokens.ink, textDecoration: 'underline' },
                // the branch that joins a child to the rail
                '&::before': nested
                    ? { content: '""', position: 'absolute', left: 10, top: '50%', width: 14, height: 2, bgcolor: tokens.rule }
                    : undefined,
            }}
        >
            {entry.label}
        </Box>
    )
}

// phones: one row that scrolls sideways and stays under the thumb, marked like the main nav (a rule under the current one)
function StripEntry({ entry, active, onGo })
{
    const current = active === entry.id
    return (
        <Box component="li" sx={{ listStyle: 'none', flexShrink: 0 }}>
            <Box
                component="a"
                href={`#${entry.id}`}
                aria-current={current ? 'location' : undefined}
                onClick={(event) => go(event, entry.id, onGo)}
                sx={{
                    display: 'block',
                    py: 1.25,
                    color: current ? tokens.ink : tokens.muted,
                    fontWeight: 700,
                    textDecoration: 'none',
                    borderBottom: `3px solid ${current ? tokens.mark : 'transparent'}`,
                }}
            >
                {entry.label}
            </Box>
        </Box>
    )
}

// sections: [{ id, label, children? }] in page order; active: the id in view
export default function DashboardNav({ sections, active, onGo, compact })
{
    const stripRef = useRef(null)

    // the strip slides sideways to keep the current section's link on screen; the page itself does not move
    useEffect(() =>
    {
        const strip = stripRef.current
        const link = strip?.querySelector('[aria-current]')
        if (link)
        {
            strip.scrollTo?.({ left: link.offsetLeft - 16, behavior: 'smooth' })
        }
    }, [active, compact])

    if (compact)
    {
        const flat = sections.flatMap((section) => [section, ...(section.children || [])])
        return (
            <Box
                ref={stripRef}
                component="nav"
                aria-label="Dashboard sections"
                sx={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    mx: -2,
                    px: 2,
                    bgcolor: 'background.default',
                    borderBottom: `1px solid ${tokens.rule}`,
                    overflowX: 'auto',
                    scrollbarWidth: 'none',
                }}
            >
                <Box component="ul" sx={{ display: 'flex', gap: 2.5, m: 0, p: 0, whiteSpace: 'nowrap' }}>
                    {flat.map((entry) => <StripEntry key={entry.id} entry={entry} active={active} onGo={onGo} />)}
                </Box>
            </Box>
        )
    }

    return (
        <Box component="nav" aria-label="Dashboard sections" sx={{ position: 'sticky', top: 24, alignSelf: 'start' }}>
            <Box component="ul" sx={{ m: 0, p: 0, borderLeft: `2px solid ${tokens.rule}` }}>
                {sections.map((section) => (
                    <Box component="li" key={section.id} sx={{ listStyle: 'none' }}>
                        <DirectoryEntry entry={section} active={active} onGo={onGo} />
                        {section.children && (
                            <Box component="ul" sx={{ m: 0, p: 0 }}>
                                {section.children.map((child) => (
                                    <Box component="li" key={child.id} sx={{ listStyle: 'none' }}>
                                        <DirectoryEntry entry={child} active={active} onGo={onGo} nested />
                                    </Box>
                                ))}
                            </Box>
                        )}
                    </Box>
                ))}
            </Box>
        </Box>
    )
}
