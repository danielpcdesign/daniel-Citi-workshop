import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import ErrorNotice from './ErrorNotice.jsx'

// the consequence in numbers, before it happens; "their" because the app does not know anyone's pronouns
function demoteConsequence(workload)
{
    if (workload === 0)
    {
        return 'They have no active tickets, so nothing is reassigned.'
    }
    const tickets = workload === 1 ? '1 active ticket' : `${workload} active tickets`
    return `Their ${tickets} will go back to Unassigned for reassignment.`
}

// cancel is focused first: the safe choice is the one Enter picks
export default function DemoteDialog({ engineer, busy, error, onCancel, onConfirm })
{
    return (
        <Dialog open={Boolean(engineer)} onClose={busy ? undefined : onCancel} aria-labelledby="demote-title" aria-describedby="demote-text">
            {engineer && (
                <>
                    <DialogTitle id="demote-title">Demote {engineer.full_name} to employee?</DialogTitle>
                    <DialogContent>
                        <DialogContentText id="demote-text">
                            {demoteConsequence(engineer.workload)} They can still report and follow their own tickets.
                        </DialogContentText>
                        <ErrorNotice error={error} sx={{ mt: 2 }} />
                    </DialogContent>
                    <DialogActions sx={{ px: 3, pb: 2 }}>
                        <Button autoFocus variant="outlined" onClick={onCancel} disabled={busy}>Cancel</Button>
                        <Button variant="contained" color="error" onClick={onConfirm} disabled={busy}>
                            {busy ? 'Demoting' : 'Demote'}
                        </Button>
                    </DialogActions>
                </>
            )}
        </Dialog>
    )
}
