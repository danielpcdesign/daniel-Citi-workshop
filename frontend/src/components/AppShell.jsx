import { useState } from 'react'
import { NavLink, Link as RouterLink } from 'react-router-dom'
import { useMediaQuery } from 'react-responsive'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import MenuIcon from '@mui/icons-material/Menu'
import { useAuth } from '../hooks/useAuth.js'
import { tokens } from '../theme.js'
import { hardNavigate } from '../utils/browser.js'

export const MOBILE_QUERY = '(max-width: 767px)'

const NAV = [
    { to: '/tickets', label: 'My tickets' },
    { to: '/report', label: 'Report a problem' },
]

const ROLE_LABEL = { employee: 'Employee', engineer: 'Engineer', admin: 'Facility admin' }

function navSx(isActive)
{
    return {
        color: tokens.ink,
        fontWeight: 700,
        textDecoration: 'none',
        paddingBlock: '6px',
        // the current page is marked by position (a rule under it), not colour alone
        borderBottom: `3px solid ${isActive ? tokens.plate : 'transparent'}`,
    }
}

export default function AppShell({ children })
{
    const { user, signOut } = useAuth()
    const isMobile = useMediaQuery({ query: MOBILE_QUERY })
    const [menuOpen, setMenuOpen] = useState(false)

    const handleSignOut = async () =>
    {
        setMenuOpen(false)
        try
        {
            await signOut()
        }
        catch
        {
            // the local session is gone either way; the server copy expires on its own
        }
        // not a router navigate: on a shared device the next person must not land on this user's last page
        hardNavigate('/signin')
    }

    return (
        <Box sx={{ minHeight: '100vh' }}>
            <Box
                component="a"
                href="#main"
                sx={{ position: 'absolute', left: -9999, '&:focus': { left: 16, top: 8, zIndex: 10, bgcolor: 'background.paper', p: 1 } }}
            >
                Skip to content
            </Box>
            <Box
                component="header"
                sx={{ bgcolor: 'background.paper', borderBottom: `1px solid ${tokens.rule}` }}
            >
                <Box sx={{ maxWidth: 1080, mx: 'auto', px: { xs: 2, md: 4 }, height: 64, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Typography
                        component={RouterLink}
                        to="/tickets"
                        variant="h5"
                        sx={{ color: tokens.ink, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 1 }}
                    >
                        <Box component="span" aria-hidden="true" sx={{ width: 14, height: 14, bgcolor: tokens.plate, borderRadius: '3px' }} />
                        ACME Facilities
                    </Typography>
                    {user && !isMobile && (
                        <>
                            <Box component="nav" aria-label="Main" sx={{ display: 'flex', gap: 3 }}>
                                {NAV.map((item) => (
                                    <NavLink key={item.to} to={item.to} style={({ isActive }) => navSx(isActive)}>
                                        {item.label}
                                    </NavLink>
                                ))}
                            </Box>
                            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Typography variant="body2" color="text.secondary">
                                    {user.full_name}, {ROLE_LABEL[user.role] || user.role}
                                </Typography>
                                <Button variant="outlined" size="small" onClick={handleSignOut}>Sign out</Button>
                            </Box>
                        </>
                    )}
                    {user && isMobile && (
                        <IconButton aria-label="Open menu" onClick={() => setMenuOpen(true)} sx={{ ml: 'auto' }}>
                            <MenuIcon />
                        </IconButton>
                    )}
                </Box>
            </Box>
            {user && isMobile && (
                <Drawer anchor="right" open={menuOpen} onClose={() => setMenuOpen(false)}>
                    <Box component="nav" aria-label="Main" sx={{ width: 260, pt: 2 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 1 }}>
                            {user.full_name}, {ROLE_LABEL[user.role] || user.role}
                        </Typography>
                        <List>
                            {NAV.map((item) => (
                                <ListItemButton key={item.to} component={NavLink} to={item.to} onClick={() => setMenuOpen(false)}>
                                    <ListItemText primary={item.label} />
                                </ListItemButton>
                            ))}
                            <ListItemButton onClick={handleSignOut}>
                                <ListItemText primary="Sign out" />
                            </ListItemButton>
                        </List>
                    </Box>
                </Drawer>
            )}
            <Box component="main" id="main" tabIndex={-1} sx={{ maxWidth: 1080, mx: 'auto', px: { xs: 2, md: 4 }, py: { xs: 3, md: 5 } }}>
                {children}
            </Box>
        </Box>
    )
}
