import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import DemoteDialog from './DemoteDialog.jsx'
import EngineerTable from './EngineerTable.jsx'
import ErrorNotice from './ErrorNotice.jsx'
import PromoteEngineer from './PromoteEngineer.jsx'
import { setAvailability } from '../services/engineerService.js'
import { changeRole } from '../services/userService.js'
import { fmtRef } from '../utils/format.js'

function returnedLine(name, incidentIds)
{
    if (!incidentIds.length)
    {
        return `${name} is now an employee. No tickets needed reassigning.`
    }
    return `${name} is now an employee. Returned to triage: ${incidentIds.map(fmtRef).join(', ')}.`
}

// who can take work and who holds it; every change is the server's call, then the table is re-read (AD-09)
// onChanged: the engineer list reloads; onRolesChanged: a demotion also moved tickets, so the counts and board reload too
export default function EngineerPanel({ engineers, onChanged, onRolesChanged })
{
    const [pendingId, setPendingId] = useState(null)
    const [promoting, setPromoting] = useState(false)
    const [demoting, setDemoting] = useState({ engineer: null, busy: false, error: null })
    const [notice, setNotice] = useState(null)
    const [error, setError] = useState(null)

    const toggle = async (engineer, isAvailable) =>
    {
        setPendingId(engineer.id)
        setError(null)
        setNotice(null)
        try
        {
            await setAvailability(engineer.id, isAvailable)
            await onChanged()
        }
        catch (failure)
        {
            setError(failure)
        }
        finally
        {
            setPendingId(null)
        }
    }

    const promote = async (user) =>
    {
        setPromoting(true)
        setError(null)
        setNotice(null)
        try
        {
            await changeRole(user.id, 'engineer')
            setNotice(`${user.full_name} is now an engineer and can be assigned tickets.`)
            await onChanged()
            return true
        }
        catch (failure)
        {
            setError(failure)
            return false
        }
        finally
        {
            setPromoting(false)
        }
    }

    const confirmDemote = async () =>
    {
        const engineer = demoting.engineer
        setDemoting({ engineer, busy: true, error: null })
        try
        {
            const result = await changeRole(engineer.id, 'employee')
            setDemoting({ engineer: null, busy: false, error: null })
            setError(null)
            setNotice(returnedLine(engineer.full_name, result.unassigned_incidents || []))
            await onRolesChanged()
        }
        catch (failure)
        {
            // the dialog stays open with the reason, so the admin can cancel or retry
            setDemoting({ engineer, busy: false, error: failure })
        }
    }

    const available = engineers.filter((engineer) => engineer.is_available).length

    return (
        <Box sx={{ display: 'grid', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
                Engineers marked unavailable can't be assigned new tickets. Tickets they already hold stay with them.
            </Typography>
            {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}
            <ErrorNotice error={error} />
            <PromoteEngineer busy={promoting} onPromote={promote} />

            {engineers.length === 0
                ? <Typography>No engineers yet. Find an employee above to make the first one.</Typography>
                : (
                    <>
                        <Typography role="status" sx={{ fontWeight: 700 }}>
                            {available} of {engineers.length} {engineers.length === 1 ? 'engineer is' : 'engineers are'} taking new work.
                        </Typography>
                        {/* positioned: keeps the table's screen-reader text inside this scroller, not widening the page */}
                        <Box sx={{ position: 'relative', overflowX: 'auto' }}>
                            <EngineerTable
                                engineers={engineers}
                                pendingId={pendingId}
                                onToggle={toggle}
                                onDemote={(engineer) => setDemoting({ engineer, busy: false, error: null })}
                            />
                        </Box>
                    </>
                )}

            <DemoteDialog
                engineer={demoting.engineer}
                busy={demoting.busy}
                error={demoting.error}
                onCancel={() => setDemoting({ engineer: null, busy: false, error: null })}
                onConfirm={confirmDemote}
            />
        </Box>
    )
}
