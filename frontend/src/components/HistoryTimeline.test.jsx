import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HistoryTimeline, { PHONE_VISIBLE } from './HistoryTimeline.jsx'
import { renderPage } from '../test/render.jsx'
import { tokens } from '../theme.js'

const NOW = new Date('2026-09-20T12:00:00+00:00').getTime()
const ERIN = { actor_id: 40, actor_name: 'Erin Employee' }
const ADA = { actor_id: 42, actor_name: 'Ada Admin' }
const ELI = { actor_id: 41, actor_name: 'Eli Engineer' }

const row = (from, to, at, actor, holder = null, reason = null) => ({
    from,
    to,
    at,
    ...actor,
    assignee_id: holder ? holder.actor_id : null,
    assignee_name: holder ? holder.actor_name : null,
    reason,
})

const CREATED = row(null, 'unassigned', '2026-09-20T09:00:00+00:00', ERIN)

function renderTimeline(history)
{
    return renderPage(<HistoryTimeline history={history} now={NOW} />)
}

function items()
{
    return within(screen.getByRole('list', { name: 'Status changes' })).getAllByRole('listitem')
}

describe('HistoryTimeline', () =>
{
    it('shows the creation row as reported, with who and when', () =>
    {
        renderTimeline([CREATED])
        expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument()
        const [created] = items()
        expect(within(created).getByText('Reported')).toBeInTheDocument()
        expect(within(created).getByText('by Erin Employee')).toBeInTheDocument()
        expect(within(created).getByText(/3 hours ago/)).toHaveAttribute('datetime', CREATED.at)
        expect(within(created).getByText(/2026/)).toBeInTheDocument()
        // nobody held it before and nobody holds it now: no change of hands to report
        expect(within(created).queryByText('Unassigned')).not.toBeInTheDocument()
    })

    it('shows a transition with its reason, newest first, blocked in the error colour', () =>
    {
        renderTimeline([
            CREATED,
            row('unassigned', 'open', '2026-09-20T10:00:00+00:00', ADA, ELI),
            row('open', 'in_progress', '2026-09-20T10:30:00+00:00', ELI, ELI),
            row('in_progress', 'blocked', '2026-09-20T11:00:00+00:00', ELI, ELI, 'Waiting for a new valve'),
        ])
        const [latest, , assigned, created] = items()
        expect(latest).toHaveTextContent(/^In progress→ to Blocked/)
        expect(within(latest).getByText('Blocked')).toHaveStyle({ color: tokens.signalRed })
        expect(within(latest).getByText('In progress')).not.toHaveStyle({ color: tokens.signalRed })
        expect(within(latest).getByText('Waiting for a new valve')).toBeInTheDocument()
        expect(within(latest).getByText('by Eli Engineer')).toBeInTheDocument()
        expect(within(latest).getByText('1 hour ago', { exact: false })).toBeInTheDocument()
        // the same engineer still holds it, so no assignee line
        expect(within(latest).queryByText(/Assigned to/)).not.toBeInTheDocument()

        expect(within(assigned).getByText('Assigned to Eli Engineer')).toBeInTheDocument()
        expect(within(assigned).getByText('by Ada Admin')).toBeInTheDocument()
        expect(within(created).getByText('Reported')).toBeInTheDocument()
    })

    it('shows a reassignment through unassigned as two changes of hands', () =>
    {
        const BEA = { actor_id: 43, actor_name: 'Bea Builder' }
        renderTimeline([
            CREATED,
            row('unassigned', 'open', '2026-09-20T09:10:00+00:00', ADA, ELI),
            row('open', 'unassigned', '2026-09-20T09:20:00+00:00', ADA, null, 'Needs a plumber, not an electrician'),
            row('unassigned', 'open', '2026-09-20T09:30:00+00:00', ADA, BEA),
        ])
        const [reassigned, returned, first] = items()
        expect(within(reassigned).getByText('Assigned to Bea Builder')).toBeInTheDocument()
        expect(within(returned).getByText('Needs a plumber, not an electrician')).toBeInTheDocument()
        expect(returned).toHaveTextContent('Open→ to Unassigned')
        // the status label and the holder line both read "Unassigned" on this row
        expect(within(returned).getAllByText('Unassigned')).toHaveLength(2)
        expect(within(first).getByText('Assigned to Eli Engineer')).toBeInTheDocument()
    })

    it('renders nothing for an empty or missing history', () =>
    {
        const { container, unmount } = renderTimeline([])
        expect(container.querySelector('section')).toBeNull()
        unmount()
        renderPage(<HistoryTimeline />)
        expect(screen.queryByRole('heading', { name: 'History' })).not.toBeInTheDocument()
    })

    it('collapses a long history on phones to the latest moves', async () =>
    {
        const user = userEvent.setup()
        globalThis.__screenWidth = 390
        renderTimeline([
            CREATED,
            row('unassigned', 'open', '2026-09-20T10:00:00+00:00', ADA, ELI),
            row('open', 'in_progress', '2026-09-20T10:30:00+00:00', ELI, ELI),
            row('in_progress', 'resolved', '2026-09-20T11:00:00+00:00', ELI, ELI),
            row('resolved', 'closed', '2026-09-20T11:30:00+00:00', ADA, ELI),
        ])
        expect(items()).toHaveLength(PHONE_VISIBLE)
        expect(screen.queryByText('Reported')).not.toBeInTheDocument()

        const toggle = screen.getByRole('button', { name: 'Show all 5 changes' })
        expect(toggle).toHaveAttribute('aria-expanded', 'false')
        await user.click(toggle)
        expect(items()).toHaveLength(5)
        expect(screen.getByText('Reported')).toBeInTheDocument()
        expect(toggle).toHaveAttribute('aria-expanded', 'true')

        await user.click(screen.getByRole('button', { name: 'Show the latest only' }))
        expect(items()).toHaveLength(PHONE_VISIBLE)
    })

    it('shows everything on a wide screen, with no toggle', () =>
    {
        renderTimeline([
            CREATED,
            row('unassigned', 'open', '2026-09-20T10:00:00+00:00', ADA, ELI),
            row('open', 'in_progress', '2026-09-20T10:30:00+00:00', ELI, ELI),
            row('in_progress', 'resolved', '2026-09-20T11:00:00+00:00', ELI, ELI),
        ])
        expect(items()).toHaveLength(4)
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
})
