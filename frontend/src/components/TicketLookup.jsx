import { useCallback, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Pagination from '@mui/material/Pagination'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ErrorNotice from './ErrorNotice.jsx'
import LookupFilters from './LookupFilters.jsx'
import LookupRow from './LookupRow.jsx'
import PageLoader from './PageLoader.jsx'
import { useDebounced } from '../hooks/useDebounced.js'
import { usePolling } from '../hooks/usePolling.js'
import { listEngineers } from '../services/engineerService.js'
import { listBuildings } from '../services/facilityService.js'
import { listIncidents } from '../services/incidentService.js'
import { tokens } from '../theme.js'

export const LOOKUP_PAGE_SIZE = 20
// long enough to wait out a word being typed, short enough to feel immediate
export const SEARCH_DEBOUNCE_MS = 300

// the server's sort allow-list is priority, created_at, updated_at, status (AD-13); status is stored as text,
// so sorting by it is alphabetical and means nothing to a reader: it is left out
const SORTS = [
    { value: '-priority,created_at', label: 'Most urgent first' },
    { value: '-created_at', label: 'Newest first' },
    { value: 'created_at', label: 'Oldest first' },
    { value: '-updated_at', label: 'Recently changed' },
]

const EMPTY = { text: '', statuses: [], priority: '', category: '', buildingId: '', assigneeId: '', escalation: '' }

// only filters that are set travel: an empty value would mean "any" anyway, and the url stays readable in the logs
function toQuery(filters, q, sort, page, isAdmin)
{
    const query = {
        q,
        status: filters.statuses,
        priority: filters.priority,
        category: filters.category,
        building_id: filters.buildingId,
        // the engineers list is admin-only; an engineer's own view is already scoped by the server (AD-09)
        assignee_id: isAdmin ? filters.assigneeId : '',
        escalation_status: filters.escalation,
    }
    const set = Object.entries(query).filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== ''))
    return { ...Object.fromEntries(set), sort, page, limit: LOOKUP_PAGE_SIZE }
}

const nothing = () => Promise.resolve(null)

// enabled: false until the section is first opened, so a closed lookup costs no requests
// runs when a filter, the sort, or the page changes; never on a timer (AD-14)
export default function TicketLookup({ enabled, isAdmin, selectedId, onSelect, aside })
{
    const [filters, setFilters] = useState(EMPTY)
    const [sort, setSort] = useState(SORTS[0].value)
    const q = useDebounced(filters.text.trim(), SEARCH_DEBOUNCE_MS)

    // a page number belongs to one set of filters: change a filter and the list starts again at page 1
    const filterKey = JSON.stringify([q, filters.statuses, filters.priority, filters.category, filters.buildingId, filters.assigneeId, filters.escalation, sort])
    const [paging, setPaging] = useState({ key: filterKey, page: 1 })
    const page = paging.key === filterKey ? paging.page : 1

    const query = useMemo(() => toQuery(filters, q, sort, page, isAdmin), [filters, q, sort, page, isAdmin])
    const loadResults = useCallback(() => (enabled ? listIncidents(query) : nothing()), [enabled, query])
    const results = usePolling(loadResults, null)

    const loadBuildings = useCallback(() => (enabled ? listBuildings() : nothing()), [enabled])
    const buildings = usePolling(loadBuildings, null)
    const loadEngineers = useCallback(() => (enabled && isAdmin ? listEngineers() : nothing()), [enabled, isAdmin])
    const engineers = usePolling(loadEngineers, null)

    const canClear = JSON.stringify({ ...filters, text: filters.text.trim() }) !== JSON.stringify(EMPTY)
    const change = (name, value) => setFilters((previous) => ({ ...previous, [name]: value }))
    const clear = () => setFilters(EMPTY)

    const data = results.data
    const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 3 }}>
            <LookupFilters
                values={filters}
                onChange={change}
                onClear={clear}
                canClear={canClear}
                isAdmin={isAdmin}
                buildings={buildings}
                engineers={engineers}
            />

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 340px' }, gap: 3, alignItems: 'start' }}>
                <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
                        <Typography role="status" variant="h5" component="p">
                            {data && (data.total === 1 ? '1 ticket' : `${data.total} tickets`)}
                        </Typography>
                        <TextField
                            select
                            size="small"
                            label="Sort by"
                            value={sort}
                            onChange={(event) => setSort(event.target.value)}
                            sx={{ minWidth: 200 }}
                        >
                            {SORTS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                        </TextField>
                    </Box>

                    <ErrorNotice
                        error={results.error}
                        sx={{ mb: 2 }}
                        action={<Button color="inherit" size="small" onClick={results.reload}>Try again</Button>}
                    />
                    {/* the first load holds the space the results will take, so a jump to History is not cut short by a short page */}
                    {results.loading && !data && enabled && (
                        <Box sx={{ minHeight: '100vh' }}>
                            <PageLoader label="Looking up tickets" />
                        </Box>
                    )}
                    {results.loading && data && <LinearProgress aria-label="Updating the results" sx={{ mb: -0.5 }} />}

                    {data && data.total === 0 && (
                        <Box sx={{ py: 4, px: 2, textAlign: 'center', border: `1px dashed ${tokens.rule}`, borderRadius: 1 }}>
                            <Typography sx={{ mb: canClear ? 1.5 : 0 }}>
                                No tickets match. Try other words, or fewer filters.
                            </Typography>
                            {canClear && <Button variant="outlined" size="small" onClick={clear}>Clear filters</Button>}
                        </Box>
                    )}

                    {data && data.items.length > 0 && (
                        <Box
                            component="ul"
                            aria-label="Lookup results"
                            sx={{
                                m: 0,
                                p: 0,
                                border: `1px solid ${tokens.rule}`,
                                borderRadius: 1,
                                overflow: 'hidden',
                                opacity: results.loading ? 0.6 : 1,
                            }}
                        >
                            {data.items.map((incident) => (
                                <LookupRow
                                    key={incident.id}
                                    incident={incident}
                                    selected={incident.id === selectedId}
                                    onSelect={onSelect}
                                />
                            ))}
                        </Box>
                    )}

                    {data && pages > 1 && (
                        <Pagination
                            count={pages}
                            page={page}
                            onChange={(event, next) => setPaging({ key: filterKey, page: next })}
                            shape="rounded"
                            sx={{ mt: 2, '& ul': { justifyContent: 'center' } }}
                        />
                    )}
                </Box>
                {aside}
            </Box>
        </Box>
    )
}
