import { useState } from 'react'
import { NavLink, Link as RouterLink, useMatch } from 'react-router-dom'
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
import SettingsIcon from '@mui/icons-material/SettingsOutlined'
import { useAuth } from '../hooks/useAuth.js'
import { srOnly, tokens } from '../theme.js'
import { hardNavigate } from '../utils/browser.js'
import { DASHBOARD_ROLES, ROLE_LABEL, heldRoles, homePath } from '../utils/roles.js'

export const MOBILE_QUERY = '(max-width: 767px)'

// roles: shown only to these; the route guard and the server still decide (AD-09)
const NAV = [
    { to: '/dashboard', label: 'Dashboard', roles: DASHBOARD_ROLES },
    { to: '/engineers', label: 'Engineers', roles: ['admin'] },
    { to: '/facilities', label: 'Facilities', roles: ['admin'] },
    { to: '/tickets', label: 'My tickets' },
    { to: '/report', label: 'Report a problem' },
]


// with more than one role held, the header says which one is in use, so a switch is never invisible
function whoLine(user)
{
    const role = ROLE_LABEL[user.role] || user.role
    return heldRoles(user).length > 1 ? `${user.full_name}, as ${role.toLowerCase()}` : `${user.full_name}, ${role}`
}

function navSx(isActive)
{
    return {
        color: tokens.ink,
        fontWeight: 700,
        textDecoration: 'none',
        paddingBlock: '6px',
        whiteSpace: 'nowrap',
        // the current page is marked by position (a rule under it), not colour alone
        borderBottom: `3px solid ${isActive ? tokens.mark : 'transparent'}`,
    }
}

export default function AppShell({ children })
{
    const { user, signOut } = useAuth()
    const isMobile = useMediaQuery({ query: MOBILE_QUERY })
    const [menuOpen, setMenuOpen] = useState(false)
    // the dashboard adds a section nav column; it gets the width for it rather than squeezing the board
    const pageWidth = useMatch('/dashboard') ? 1320 : 1080
    const nav = user ? NAV.filter((item) => !item.roles || item.roles.includes(user.role)) : []

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
                <Box sx={{ maxWidth: pageWidth, mx: 'auto', px: { xs: 2, md: 4 }, height: 64, display: 'flex', alignItems: 'center', gap: { md: 3, lg: 4 } }}>
                    <Typography
                        component={RouterLink}
                        to={homePath(user)}
                        variant="h5"
                        sx={{ color: tokens.ink, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 1, whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                        <Box component="span" aria-hidden="true" sx={{ width: 14, height: 14, bgcolor: tokens.mark, borderRadius: '3px' }} />
                        ACME Facilities
                    </Typography>
                    {user && !isMobile && (
                        <>
                            <Box component="nav" aria-label="Main" sx={{ display: 'flex', gap: { md: 2.5, lg: 3 }, flexShrink: 0 }}>
                                {nav.map((item) => (
                                    <NavLink key={item.to} to={item.to} style={({ isActive }) => navSx(isActive)}>
                                        {item.label}
                                    </NavLink>
                                ))}
                            </Box>
                            {/* the header stays one line: with an admin's five links, the name gives way first */}
                            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                                {/* who, in which role, and the way to this device's settings: the nav has no room left at 1280 px */}
                                <Box
                                    component={RouterLink}
                                    to="/settings"
                                    title={`Settings for ${whoLine(user)}`}
                                    sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, color: 'text.secondary', textDecoration: 'none', '&:hover': { color: 'text.primary', textDecoration: 'underline' } }}
                                >
                                    <SettingsIcon aria-hidden="true" fontSize="small" sx={{ flexShrink: 0 }} />
                                    <Typography variant="body2" component="span" noWrap>
                                        {whoLine(user)}
                                    </Typography>
                                    <Box component="span" sx={srOnly}>, settings</Box>
                                </Box>
                                <Button variant="outlined" size="small" onClick={handleSignOut} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>Sign out</Button>
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
                            {whoLine(user)}
                        </Typography>
                        <List>
                            {nav.map((item) => (
                                <ListItemButton key={item.to} component={NavLink} to={item.to} onClick={() => setMenuOpen(false)}>
                                    <ListItemText primary={item.label} />
                                </ListItemButton>
                            ))}
                            <ListItemButton component={NavLink} to="/settings" onClick={() => setMenuOpen(false)}>
                                <ListItemText primary="Settings" />
                            </ListItemButton>
                            <ListItemButton onClick={handleSignOut}>
                                <ListItemText primary="Sign out" />
                            </ListItemButton>
                        </List>
                    </Box>
                </Drawer>
            )}
            <Box component="main" id="main" tabIndex={-1} sx={{ maxWidth: pageWidth, mx: 'auto', px: { xs: 2, md: 4 }, py: { xs: 3, md: 5 } }}>
                {children}
            </Box>
        </Box>
    )
}
