import { createTheme } from '@mui/material/styles'

// facility signage: an enamel plate, paper, ink, and two signal colours kept for meaning only
export const tokens = {
    plate: '#1F3A4D',
    paper: '#F4F6F7',
    ink: '#172026',
    rule: '#CBD3D8',
    signalRed: '#B42318',
    signalAmber: '#B7791F',
    surface: '#FFFFFF',
    muted: '#4A5761',
}

// radius grows with the size of the thing: tags < controls < surfaces < the incident plate
export const radius = {
    tag: 3,
    control: 6,
    surface: 8,
    plate: 12,
}

const display = '"Overpass", "Atkinson Hyperlegible", system-ui, sans-serif'
const text = '"Atkinson Hyperlegible", system-ui, sans-serif'

export const theme = createTheme({
    palette: {
        primary: { main: tokens.plate, contrastText: tokens.paper },
        error: { main: tokens.signalRed },
        warning: { main: tokens.signalAmber },
        background: { default: tokens.paper, paper: tokens.surface },
        text: { primary: tokens.ink, secondary: tokens.muted },
        divider: tokens.rule,
    },
    shape: { borderRadius: radius.control },
    typography: {
        fontFamily: text,
        fontSize: 15,
        // a modular scale (1.25) from a 16px body
        h1: { fontFamily: display, fontWeight: 800, fontSize: '2.44rem', lineHeight: 1.1, letterSpacing: '-0.01em' },
        h2: { fontFamily: display, fontWeight: 800, fontSize: '1.95rem', lineHeight: 1.15 },
        h3: { fontFamily: display, fontWeight: 700, fontSize: '1.56rem', lineHeight: 1.2 },
        h4: { fontFamily: display, fontWeight: 700, fontSize: '1.25rem', lineHeight: 1.25 },
        h5: { fontFamily: display, fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.3 },
        h6: { fontFamily: display, fontWeight: 700, fontSize: '1rem', lineHeight: 1.3 },
        body1: { fontSize: '1rem', lineHeight: 1.55 },
        body2: { fontSize: '0.9rem', lineHeight: 1.5 },
        button: { fontFamily: display, fontWeight: 700, textTransform: 'none', letterSpacing: 0 },
        // no tracked-out capitals anywhere: labels stay in sentence case
        overline: { textTransform: 'none', letterSpacing: 0, fontSize: '0.8rem', lineHeight: 1.4 },
        caption: { fontSize: '0.8rem', lineHeight: 1.4 },
    },
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                body: { backgroundColor: tokens.paper },
                // one visible, consistent focus ring for keyboard users
                ':focus-visible': { outline: `3px solid ${tokens.signalAmber}`, outlineOffset: 2 },
                '@media (prefers-reduced-motion: reduce)': {
                    '*, *::before, *::after': {
                        animationDuration: '0.01ms !important',
                        animationIterationCount: '1 !important',
                        transitionDuration: '0.01ms !important',
                        scrollBehavior: 'auto !important',
                    },
                },
            },
        },
        MuiButtonBase: {
            defaultProps: { disableRipple: true },
        },
        MuiButton: {
            defaultProps: { disableElevation: true },
            styleOverrides: {
                root: { borderRadius: radius.control, paddingInline: 16, minHeight: 40 },
            },
        },
        MuiPaper: {
            defaultProps: { elevation: 0 },
            styleOverrides: {
                root: { borderRadius: radius.surface },
                outlined: { borderColor: tokens.rule },
            },
        },
        MuiChip: {
            styleOverrides: {
                root: { borderRadius: radius.tag, fontWeight: 700 },
            },
        },
        MuiOutlinedInput: {
            styleOverrides: {
                root: { backgroundColor: tokens.surface },
                notchedOutline: { borderColor: tokens.rule },
            },
        },
        MuiDialog: {
            styleOverrides: {
                paper: { borderRadius: radius.surface },
            },
        },
        MuiLink: {
            defaultProps: { underline: 'always' },
        },
        MuiStepIcon: {
            styleOverrides: {
                text: { fontFamily: display, fontWeight: 700 },
            },
        },
    },
})

// read by screen readers, not drawn: context that sighted users get from layout
export const srOnly = {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
}
