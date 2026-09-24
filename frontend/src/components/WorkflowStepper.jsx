import { useMediaQuery } from 'react-responsive'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import Typography from '@mui/material/Typography'
import { MOBILE_QUERY } from './AppShell.jsx'
import { STEPS, fmtDateTime, fmtStatus, latestReason, stepIndex } from '../utils/format.js'

// when each step was last entered; a reassignment re-enters "open", and the latest entry is the one that counts
function enteredAt(history, step)
{
    const entries = history.filter((entry) => entry.to === step)
    return entries.length ? entries[entries.length - 1].at : null
}

// the linear path with blocked as an error on the current step, not a step of its own (AD-18)
export default function WorkflowStepper({ incident })
{
    const isMobile = useMediaQuery({ query: MOBILE_QUERY })
    const history = incident.history || []
    const current = stepIndex(incident.status)
    const blocked = incident.status === 'blocked'
    // a closed ticket has nothing left to do, so its last step reads as done, not in progress
    const active = incident.status === 'closed' ? STEPS.length : current

    return (
        <Stepper
            activeStep={active}
            orientation={isMobile ? 'vertical' : 'horizontal'}
            alternativeLabel={!isMobile}
            aria-label="Progress"
        >
            {STEPS.map((step, index) =>
            {
                const isCurrent = index === current
                const error = isCurrent && blocked
                const at = index <= current ? enteredAt(history, error ? 'blocked' : step) : null
                let caption = null
                if (error)
                {
                    caption = (
                        <>
                            <Typography variant="caption" color="error" component="span" sx={{ display: 'block', fontWeight: 700 }}>
                                Blocked{at ? ` since ${fmtDateTime(at)}` : ''}
                            </Typography>
                            <Typography variant="caption" color="error" component="span" sx={{ display: 'block' }}>
                                {latestReason(history, 'blocked') || 'No reason recorded'}
                            </Typography>
                        </>
                    )
                }
                else if (at)
                {
                    caption = <Typography variant="caption" color="text.secondary" component="span">{fmtDateTime(at)}</Typography>
                }
                return (
                    <Step key={step} completed={index < current || incident.status === 'closed'}>
                        <StepLabel error={error} optional={caption}>
                            {isCurrent ? <strong>{fmtStatus(step)}</strong> : fmtStatus(step)}
                        </StepLabel>
                    </Step>
                )
            })}
        </Stepper>
    )
}
