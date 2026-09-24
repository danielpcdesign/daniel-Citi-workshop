import { useCallback, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ArchiveDialog from './ArchiveDialog.jsx'
import ErrorNotice from './ErrorNotice.jsx'
import NameForm from './NameForm.jsx'
import PageLoader from './PageLoader.jsx'
import { usePolling } from '../hooks/usePolling.js'
import { archivePlace, createPlace, listFloors, listSeats, renamePlace } from '../services/facilityService.js'
import { LEVELS } from '../utils/facilities.js'
import { tokens } from '../theme.js'

const LIST = { floor: listFloors, seat: listSeats }
const NAME_VARIANT = { building: 'h6', floor: 'body1', seat: 'body2' }

// the places under one parent, loaded only once the parent is opened; a helper of FacilityNode, which it nests
function PlaceChildren({ level, parent, id })
{
    const load = useCallback(() => LIST[level](parent.id), [level, parent.id])
    const children = usePolling(load, null)
    const { noun, plural } = LEVELS[level]
    const add = async (name) =>
    {
        await createPlace(level, parent.id, name)
        await children.reload()
    }

    return (
        <Box id={id} sx={{ ml: { xs: 1.5, md: 2.5 }, pl: { xs: 1.5, md: 2 }, borderLeft: `2px solid ${tokens.rule}`, display: 'grid', gap: 1, pb: 1 }}>
            <ErrorNotice
                error={children.error}
                action={<Button color="inherit" size="small" onClick={children.reload}>Try again</Button>}
            />
            {children.loading && !children.data && <PageLoader label={`Loading ${plural}`} />}
            {children.data && children.data.total === 0 && (
                <Typography variant="body2" color="text.secondary">No {plural} yet.</Typography>
            )}
            {children.data && children.data.items.length > 0 && (
                <Box component="ul" aria-label={`${plural.charAt(0).toUpperCase() + plural.slice(1)} of ${parent.name}`} sx={{ m: 0, p: 0 }}>
                    {children.data.items.map((place) => (
                        <FacilityNode key={place.id} level={level} place={place} onChanged={children.reload} />
                    ))}
                </Box>
            )}
            <NameForm label={`New ${noun} in ${parent.name}`} submitLabel={`Add ${noun}`} busyLabel="Adding" onSubmit={add} />
        </Box>
    )
}

// one place in the tree: open it to see what is inside, rename it in place, or archive it (AD-22)
// onChanged re-reads the list this place sits in: a rename can move it, an archive removes it
export default function FacilityNode({ level, place, onChanged })
{
    const [expanded, setExpanded] = useState(false)
    const [renaming, setRenaming] = useState(false)
    const [archive, setArchive] = useState({ open: false, busy: false, error: null })
    const child = LEVELS[level].child
    const childrenId = `${level}-${place.id}-children`

    const rename = async (name) =>
    {
        await renamePlace(level, place.id, name)
        setRenaming(false)
        await onChanged()
    }

    const confirmArchive = async () =>
    {
        setArchive({ open: true, busy: true, error: null })
        try
        {
            await archivePlace(level, place.id)
            setArchive({ open: false, busy: false, error: null })
            await onChanged()
        }
        catch (failure)
        {
            setArchive({ open: true, busy: false, error: failure })
        }
    }

    return (
        <Box component="li" sx={{ listStyle: 'none' }}>
            {/* one line per place: a long name wraps within its own space, so the actions line up on every row */}
            <Box sx={{ display: 'flex', flexWrap: renaming ? 'wrap' : 'nowrap', alignItems: 'center', columnGap: 1, rowGap: 0.5, py: 0.5, borderBottom: `1px solid ${tokens.rule}` }}>
                {child
                    ? (
                        <IconButton
                            size="small"
                            aria-expanded={expanded}
                            aria-controls={expanded ? childrenId : undefined}
                            aria-label={`${expanded ? 'Hide' : 'Show'} ${LEVELS[child].plural} in ${place.name}`}
                            onClick={() => setExpanded((open) => !open)}
                        >
                            {expanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
                        </IconButton>
                    )
                    : <Box aria-hidden="true" sx={{ width: 34 }} />}
                {renaming
                    ? (
                        <Box sx={{ flex: '1 1 260px', py: 0.5 }}>
                            <NameForm
                                label={`New name for ${place.name}`}
                                initialName={place.name}
                                submitLabel="Save name"
                                busyLabel="Saving"
                                onSubmit={rename}
                                onCancel={() => setRenaming(false)}
                                autoFocus
                            />
                        </Box>
                    )
                    : (
                        <>
                            <Typography
                                variant={NAME_VARIANT[level]}
                                component="span"
                                sx={{ flex: '1 1 0', minWidth: 0, overflowWrap: 'anywhere', fontWeight: level === 'seat' ? 400 : 700 }}
                            >
                                {place.name}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                                <Button size="small" onClick={() => setRenaming(true)} aria-label={`Rename ${place.name}`}>Rename</Button>
                                <Button
                                    size="small"
                                    color="error"
                                    onClick={() => setArchive({ open: true, busy: false, error: null })}
                                    aria-label={`Archive ${place.name}`}
                                >
                                    Archive
                                </Button>
                            </Box>
                        </>
                    )}
            </Box>
            {expanded && child && <PlaceChildren level={child} parent={place} id={childrenId} />}
            <ArchiveDialog
                open={archive.open}
                level={level}
                place={place}
                busy={archive.busy}
                error={archive.error}
                onCancel={() => setArchive({ open: false, busy: false, error: null })}
                onConfirm={confirmArchive}
            />
        </Box>
    )
}
