import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import AssignDialog from './AssignDialog.jsx'
import ErrorNotice from './ErrorNotice.jsx'
import ReasonDialog from './ReasonDialog.jsx'
import {
    assignIncident,
    decideEscalation,
    requestEscalation,
    transitionIncident,
} from '../services/incidentService.js'
import { ESCALATION_LABEL, nextStep, stepIndex } from '../utils/format.js'

// wording per target status; which targets exist at all comes only from the server (AD-09, AD-17)
function transitionCopy(target, current)
{
    const copy = {
        unassigned: {
            label: 'Return to triage',
            title: 'Return this ticket to triage',
            prompt: 'The engineer is taken off the ticket so an admin can assign someone else. Say why.',
            reasonLabel: 'Reason for reassigning',
        },
        open: { label: 'Move back to Open' },
        in_progress: { label: current === 'blocked' ? 'Resume work' : 'Start work' },
        blocked: {
            label: 'Mark as blocked',
            title: 'What is blocking this ticket?',
            prompt: 'Say what is needed before work can continue. The person who reported it will see this.',
            reasonLabel: 'What is blocking it',
        },
        resolved: { label: 'Mark as fixed' },
        closed: { label: 'Close ticket' },
    }
    return copy[target] || { label: target }
}

// blocked and returning to triage must say why (AD-17); the server still rejects a missing reason
function needsReason(target)
{
    return target === 'blocked' || target === 'unassigned'
}

const DECISIONS = [
    { status: 'granted', label: 'Grant escalation' },
    { status: 'declined', label: 'Decline escalation' },
    { status: 'none', label: 'Clear escalation' },
]

export default function IncidentActions({ incident, onChanged })
{
    const { actions } = incident
    const [dialog, setDialog] = useState(null)
    const [busyTarget, setBusyTarget] = useState(null)
    const [error, setError] = useState(null)

    const done = () =>
    {
        setError(null)
        onChanged()
    }

    const moveDirectly = async (target) =>
    {
        setBusyTarget(target)
        setError(null)
        try
        {
            await transitionIncident(incident.id, target)
            done()
        }
        catch (moveError)
        {
            setError(moveError)
        }
        finally
        {
            setBusyTarget(null)
        }
    }

    // the natural next move gets the filled button; everything else is secondary
    const forward = [...actions.transitions]
        .filter((target) => !needsReason(target) && stepIndex(target) > stepIndex(incident.status))
        .sort((a, b) => stepIndex(a) - stepIndex(b))[0]
    const primary = incident.status === 'blocked' && actions.transitions.includes('in_progress') ? 'in_progress' : forward
    const decisions = actions.set_escalation ? DECISIONS.filter((option) => option.status !== incident.escalation_status) : []
    const nothingToDo = !actions.assign && actions.transitions.length === 0 && !actions.request_escalation && decisions.length === 0

    let reasonProps = null
    if (dialog?.kind === 'transition')
    {
        const copy = transitionCopy(dialog.to, incident.status)
        reasonProps = {
            title: copy.title,
            prompt: copy.prompt,
            label: copy.reasonLabel,
            confirmLabel: copy.label,
            onConfirm: async (reason) =>
            {
                await transitionIncident(incident.id, dialog.to, reason)
                done()
            },
        }
    }
    else if (dialog?.kind === 'request')
    {
        reasonProps = {
            title: 'Ask for escalation',
            prompt: 'An admin will read your reason and decide. Your reason is added to the conversation.',
            label: 'Why does this need more urgency?',
            confirmLabel: 'Send request',
            onConfirm: async (reason) =>
            {
                await requestEscalation(incident.id, reason)
                done()
            },
        }
    }
    else if (dialog?.kind === 'decide')
    {
        const option = DECISIONS.find((item) => item.status === dialog.status)
        reasonProps = {
            title: option.label,
            prompt: 'Your reason is added to the conversation, so the reporter knows what was decided and why.',
            label: 'Reason',
            confirmLabel: option.label,
            onConfirm: async (reason) =>
            {
                await decideEscalation(incident.id, dialog.status, reason)
                done()
            },
        }
    }

    return (
        <Paper variant="outlined" component="section" aria-labelledby="next-heading" sx={{ p: { xs: 2, md: 3 } }}>
            <Typography id="next-heading" variant="h5" component="h2" sx={{ mb: 1 }}>What happens next</Typography>
            <Typography sx={{ mb: nothingToDo ? 0 : 2.5 }}>{nextStep(incident)}</Typography>

            <ErrorNotice error={error} sx={{ mb: 2 }} />

            <Stack spacing={1.25}>
                {actions.assign && (
                    <Button variant="contained" onClick={() => setDialog({ kind: 'assign' })}>Assign an engineer</Button>
                )}
                {actions.transitions.map((target) =>
                {
                    const copy = transitionCopy(target, incident.status)
                    return (
                        <Button
                            key={target}
                            variant={target === primary ? 'contained' : 'outlined'}
                            color={target === 'blocked' ? 'error' : 'primary'}
                            disabled={busyTarget !== null}
                            onClick={() => (needsReason(target) ? setDialog({ kind: 'transition', to: target }) : moveDirectly(target))}
                        >
                            {busyTarget === target ? 'Saving' : copy.label}
                        </Button>
                    )
                })}
                {actions.request_escalation && (
                    <Button variant="outlined" onClick={() => setDialog({ kind: 'request' })}>Ask for escalation</Button>
                )}
            </Stack>

            {decisions.length > 0 && (
                <Box sx={{ mt: 3 }}>
                    <Typography variant="h6" component="h3">Escalation</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                        {ESCALATION_LABEL[incident.escalation_status]}
                    </Typography>
                    <Stack spacing={1.25}>
                        {decisions.map((option) => (
                            <Button key={option.status} variant="outlined" onClick={() => setDialog({ kind: 'decide', status: option.status })}>
                                {option.label}
                            </Button>
                        ))}
                    </Stack>
                </Box>
            )}

            {reasonProps && (
                <ReasonDialog open required onClose={() => setDialog(null)} {...reasonProps} />
            )}
            <AssignDialog
                open={dialog?.kind === 'assign'}
                onClose={() => setDialog(null)}
                onAssign={async (engineerId) =>
                {
                    await assignIncident(incident.id, engineerId)
                    done()
                }}
            />
        </Paper>
    )
}
