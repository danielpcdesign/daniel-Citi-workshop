import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import ErrorNotice from './ErrorNotice.jsx'
import { CASCADE } from '../utils/facilities.js'

// archiving cannot be undone from the app, so the consequence is stated first and Cancel is the default
export default function ArchiveDialog({ open, level, place, busy, error, onCancel, onConfirm })
{
    return (
        <Dialog open={open} onClose={busy ? undefined : onCancel} aria-labelledby="archive-title" aria-describedby="archive-text">
            <DialogTitle id="archive-title">Archive {place.name}?</DialogTitle>
            <DialogContent>
                <DialogContentText id="archive-text">
                    {CASCADE[level] && `${CASCADE[level]} `}
                    Tickets already reported there keep the name, marked as archived. It can no longer be picked for new tickets.
                </DialogContentText>
                <ErrorNotice error={error} sx={{ mt: 2 }} />
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button autoFocus variant="outlined" onClick={onCancel} disabled={busy}>Cancel</Button>
                <Button variant="contained" color="error" onClick={onConfirm} disabled={busy}>
                    {busy ? 'Archiving' : 'Archive'}
                </Button>
            </DialogActions>
        </Dialog>
    )
}
