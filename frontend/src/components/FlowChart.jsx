import { useState } from 'react'
import { useTheme } from '@mui/material/styles'
import { LineChart } from '@mui/x-charts/LineChart'
import Box from '@mui/material/Box'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { DEFAULT_RANGE, FLOW_STATUSES, RANGES, STACK_ORDER, flowIsEmpty, flowRange } from '../utils/flow.js'
import { STATUS_LABEL } from '../utils/format.js'

// minutes shown: the last point is "now", which is rarely on the hour
const hourLabel = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const fullLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const list = new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' })

// the words behind the chart, for anyone who cannot see it and anyone who wants the number, not the shape
function nowLine(point)
{
    const parts = FLOW_STATUSES.map((status) => `${point[status]} ${STATUS_LABEL[status].toLowerCase()}`)
    return `Now: ${list.format(parts)}.`
}

// tickets in each status over time, stacked; the section around it owns loading and errors (DashboardSection)
export default function FlowChart({ flow })
{
    const [rangeKey, setRangeKey] = useState(DEFAULT_RANGE)
    // the band colours follow the appearance and colour settings (theme.acme.status)
    const statusColors = useTheme().acme.status
    const range = RANGES.find((candidate) => candidate.key === rangeKey)
    const points = flowRange(flow.points, rangeKey)
    const latest = flow.points[flow.points.length - 1]
    const axisLabel = range.hourly ? hourLabel : dayLabel

    return (
        <Box sx={{ display: 'grid', gap: 2 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                {latest && <Typography sx={{ fontWeight: 700 }}>{nowLine(latest)}</Typography>}
                <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={rangeKey}
                    aria-label="Range"
                    // a pressed button stays pressed: there is always one range
                    onChange={(event, next) => next && setRangeKey(next)}
                >
                    {RANGES.map((option) => <ToggleButton key={option.key} value={option.key}>{option.label}</ToggleButton>)}
                </ToggleButtonGroup>
            </Box>

            {points.length === 0 || flowIsEmpty(points)
                ? <Typography>No tickets in this range.</Typography>
                : (
                    <Box role="figure" aria-label={`Tickets in each status, ${range.label.toLowerCase()}`}>
                        <LineChart
                            height={320}
                            dataset={points}
                            margin={{ left: 8, right: 32 }}
                            // no morphing between ranges: 7 points turning into 14 draws paths that loop back on themselves
                            skipAnimation
                            // one evenly spaced place per sample: a day is its end-of-day snapshot, so a time scale would
                            // put "Sep 19" at 23:00 and label half-days; the tooltip still gives the exact moment
                            xAxis={[{
                                dataKey: 'time',
                                scaleType: 'point',
                                valueFormatter: (value, context) => (context.location === 'tick' ? axisLabel.format(value) : fullLabel.format(value)),
                            }]}
                            yAxis={[{ tickMinStep: 1 }]}
                            series={STACK_ORDER.map((status) => ({
                                dataKey: status,
                                label: STATUS_LABEL[status],
                                color: statusColors[status],
                                area: true,
                                stack: 'total',
                                showMark: false,
                                // straight lines between snapshots: a smoothed curve would invent values in between
                                curve: 'linear',
                            }))}
                        />
                    </Box>
                )}
        </Box>
    )
}
